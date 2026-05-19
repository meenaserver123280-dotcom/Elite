const router      = require('express').Router();
const User        = require('../models/User');
const Lifafa      = require('../models/Lifafa');
const Transaction = require('../models/Transaction');
const { auth }    = require('./auth');

const BOT_TOKEN  = process.env.BOT_TOKEN   || '';
const ADMIN_TG   = process.env.ADMIN_TG_ID || '';

const getIST = () => new Date().toLocaleString('en-IN', {
  timeZone:'Asia/Kolkata', hour12:true,
  day:'2-digit', month:'short', year:'numeric',
  hour:'2-digit', minute:'2-digit'
});

async function sendTG(tg_id, text) {
  if (!tg_id || !BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id:tg_id, text, parse_mode:'HTML' })
    });
  } catch(e) {}
}

// GET /lifafa/:code
router.get('/:code', async (req, res) => {
  try {
    const l = await Lifafa.findOne({ code:req.params.code.toUpperCase(), status:'active' }).populate('creator_id','name');
    if (!l) return res.status(404).json({ status:'error', message:'Invalid or expired code' });
    const perAmt    = l.per_user_amount > 0 ? l.per_user_amount : l.max_range;
    const totalFund = parseFloat((perAmt * l.max_users).toFixed(2));
    const claimUsed = parseFloat((l.claimed_users * perAmt).toFixed(2));
    const referUsed = parseFloat((l.refer_fund_used || 0).toFixed(2));
    const remaining = parseFloat(Math.max(0, totalFund - claimUsed - referUsed).toFixed(2));
    const obj = l.toObject();
    res.json({ status:'success', lifafa:{ ...obj, has_access_code:!!(obj.access_code && obj.access_code.trim()), total_fund:totalFund, total_used:claimUsed+referUsed, remaining } });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// POST /lifafa/create
router.post('/create', auth, async (req, res) => {
  try {
    const { code, type, amt, min_range, max_range, toss_answer, users, channels, refer_bonus, access_code } = req.body;
    const perAmt    = type === 'scratch' ? parseFloat(max_range) : parseFloat(amt);
    const totalFund = parseFloat((perAmt * parseInt(users)).toFixed(2));
    if (!totalFund || totalFund <= 0) return res.status(400).json({ status:'error', message:'Invalid amount/users' });
    const sender = await User.findById(req.user.id);
    if (!sender) return res.status(404).json({ status:'error', message:'User not found' });
    if (sender.balance < totalFund) return res.status(400).json({ status:'error', message:`Insufficient balance. Need ₹${totalFund}` });
    if (await Lifafa.findOne({ code:code.toUpperCase() })) return res.status(400).json({ status:'error', message:'Code already exists' });
    await User.findByIdAndUpdate(sender._id, { $inc:{ balance:-totalFund } });
    await Transaction.create({ sender_id:sender._id, amount:totalFund, type:'transfer', status:'success', remark:`Created Lifafa: ${code}`, tx_time:new Date() });
    const lifafa = await Lifafa.create({
      creator_id:sender._id, creator_mobile:sender.mobile,
      code:code.toUpperCase(), type,
      per_user_amount:parseFloat(amt)||0,
      min_range:parseFloat(min_range)||0,
      max_range:parseFloat(max_range)||0,
      toss_answer:toss_answer||'',
      max_users:parseInt(users),
      channels:channels||[],
      refer_bonus:parseFloat(refer_bonus)||0,
      access_code:access_code?access_code.trim().toUpperCase():''
    });
    if (sender.tg_id) sendTG(sender.tg_id,
      `🧧 <b>Lifafa Created!</b>\n\nCode: <code>${lifafa.code}</code>\nType: ${type}\nFund: ₹${totalFund}\nUsers: ${users}\nDate: ${getIST()}\n\n⚡ ELITEPAY`
    );
    res.json({ status:'success', code:lifafa.code, claim_url:`/claim.html?code=${lifafa.code}`, total_deducted:totalFund });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// POST /lifafa/claim
router.post('/claim', async (req, res) => {
  try {
    const { code, mobile, guess, ref_code, access_code } = req.body;
    const user   = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ status:'error', message:'Mobile not found' });
    const lifafa = await Lifafa.findOne({ code:code.toUpperCase(), status:'active' });
    if (!lifafa) return res.status(404).json({ status:'error', message:'Invalid or expired code' });
    if (lifafa.access_code && lifafa.access_code.trim()) {
      if (!access_code || access_code.trim().toUpperCase() !== lifafa.access_code) return res.status(400).json({ status:'error', message:'Wrong access code!' });
    }
    const rem = `Loot_${code}_${mobile}`;
    if (await Transaction.findOne({ remark:rem })) return res.status(400).json({ status:'error', message:'Already claimed!' });
    const perAmt    = lifafa.per_user_amount > 0 ? lifafa.per_user_amount : lifafa.max_range;
    const totalFund = parseFloat((perAmt * lifafa.max_users).toFixed(2));
    let amt = lifafa.per_user_amount;
    if (lifafa.type === 'scratch') {
      amt = Math.floor(Math.random() * (lifafa.max_range * 100 - lifafa.min_range * 100 + 1) + lifafa.min_range * 100) / 100;
    }
    if (lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      await Transaction.create({ receiver_id:user._id, amount:0, remark:rem, type:'transfer', status:'failed', tx_time:new Date() });
      return res.status(400).json({ status:'error', message:'Wrong guess! Locked.' });
    }
    amt = parseFloat(amt.toFixed(2));
    const claimDoc = await Lifafa.findOneAndUpdate(
      { _id:lifafa._id, status:'active', $expr:{ $lte:[{ $add:[{ $multiply:['$claimed_users', perAmt] },{ $ifNull:['$refer_fund_used',0] }, amt] }, totalFund] } },
      { $inc:{ claimed_users:1 } }, { new:true }
    );
    if (!claimDoc) return res.status(400).json({ status:'error', message:'Lifafa fund khatam!' });
    const now = new Date(); const dt = getIST();
    await User.findByIdAndUpdate(user._id, { $inc:{ balance:+amt } });
    await Transaction.create({ receiver_id:user._id, amount:amt, remark:rem, type:'transfer', status:'success', tx_time:now });
    if (user.tg_id) sendTG(user.tg_id, `🧧 <b>Lifafa Claimed!</b>\n\nCode: <code>${code}</code>\nAmount: ₹${amt}\nDate: ${dt}\n\n✅ Balance mein add ho gaya!\n⚡ ELITEPAY`);
    const creator = await User.findById(lifafa.creator_id).select('tg_id name');
    if (creator?.tg_id) sendTG(creator.tg_id, `👋 <b>Someone Claimed Your Lifafa!</b>\n\nCode: <code>${code}</code>\nBy: ${user.name} (${user.mobile})\nAmount: ₹${amt}\nDate: ${dt}\n⚡ ELITEPAY`);
    res.json({ status:'success', amount:amt, message:`₹${amt} added to wallet!` });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;
