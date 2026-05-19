const router    = require('express').Router();
const User      = require('../models/User');
const GiftCode  = require('../models/GiftCode');
const Transaction = require('../models/Transaction');
const { auth }  = require('./auth');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

async function sendTG(tg_id, text) {
  if (!tg_id || !BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id:tg_id, text, parse_mode:'HTML' })
    });
  } catch(e) {}
}

// Create gift code (admin only via ADMIN_SECRET)
router.post('/create', async (req, res) => {
  try {
    const { key, code, amount, max_uses, expires_hours } = req.body;
    if (key !== process.env.ADMIN_SECRET) return res.status(403).json({ status:'error', message:'Unauthorized' });
    if (!code || !amount) return res.status(400).json({ status:'error', message:'code and amount required' });
    if (await GiftCode.findOne({ code:code.toUpperCase() })) return res.status(400).json({ status:'error', message:'Code already exists' });
    const expires_at = expires_hours ? new Date(Date.now() + parseInt(expires_hours) * 3600000) : null;
    const gc = await GiftCode.create({ code:code.toUpperCase(), amount:parseFloat(amount), max_uses:parseInt(max_uses)||1, expires_at });
    res.json({ status:'success', code:gc.code, amount:gc.amount, max_uses:gc.max_uses });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Redeem gift code
router.post('/redeem', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ status:'error', message:'Code required' });
    const user = await User.findById(req.user.id);
    const gc   = await GiftCode.findOne({ code:code.toUpperCase(), active:true });
    if (!gc) return res.status(404).json({ status:'error', message:'Invalid or expired code' });
    if (gc.expires_at && new Date() > gc.expires_at) return res.status(400).json({ status:'error', message:'Code expired!' });
    if (gc.used_by.includes(user.mobile)) return res.status(400).json({ status:'error', message:'Already redeemed!' });
    if (gc.used_count >= gc.max_uses) return res.status(400).json({ status:'error', message:'Code limit reached!' });
    await GiftCode.findByIdAndUpdate(gc._id, { $inc:{ used_count:1 }, $push:{ used_by:user.mobile }, ...(gc.used_count+1 >= gc.max_uses ? { active:false } : {}) });
    await User.findByIdAndUpdate(user._id, { $inc:{ balance:gc.amount } });
    await Transaction.create({ receiver_id:user._id, amount:gc.amount, type:'transfer', status:'success', remark:`Gift Code: ${gc.code}`, tx_time:new Date() });
    if (user.tg_id) sendTG(user.tg_id, `🎁 <b>Gift Code Redeemed!</b>\n\nCode: <code>${gc.code}</code>\nAmount: ₹${gc.amount}\n\n✅ Balance mein add ho gaya!\n⚡ ELITEPAY`);
    res.json({ status:'success', amount:gc.amount, message:`₹${gc.amount} added to wallet!` });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;
