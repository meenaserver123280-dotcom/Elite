const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('./auth');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

const getIST = () => new Date().toLocaleString('en-IN', {
  timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
  year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
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

// Lookup
router.get('/lookup/:mobile', auth, async (req, res) => {
  try {
    const u = await User.findOne({ mobile:req.params.mobile }).select('name mobile');
    if (!u) return res.json({ status:'error', message:'User not found' });
    res.json({ status:'success', name:u.name, mobile:u.mobile });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// P2P Send
router.post('/send', auth, async (req, res) => {
  try {
    const { receiver_mobile, amount, comment } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status:'error', message:'Minimum ₹1' });
    const sender   = await User.findById(req.user.id);
    const receiver = await User.findOne({ mobile:receiver_mobile });
    if (!receiver) return res.status(404).json({ status:'error', message:'Receiver not found' });
    if (receiver._id.equals(sender._id)) return res.status(400).json({ status:'error', message:'Cannot send to yourself' });
    if (sender.balance < amt) return res.status(400).json({ status:'error', message:`Insufficient balance. Available: ₹${sender.balance}` });
    const txId = 'EP' + Date.now().toString().slice(-8);
    const now  = new Date();
    const dt   = getIST();
    await User.findByIdAndUpdate(sender._id,   { $inc:{ balance:-amt } });
    await User.findByIdAndUpdate(receiver._id, { $inc:{ balance:+amt } });
    await Transaction.create({ tx_id:txId, sender_id:sender._id, receiver_id:receiver._id, amount:amt, type:'transfer', status:'success', remark:comment||`Transfer to ${receiver_mobile}`, tx_time:now });
    const sNew = await User.findById(sender._id).select('balance tg_id');
    const rNew = await User.findById(receiver._id).select('balance tg_id');
    if (sNew.tg_id) sendTG(sNew.tg_id, `⚡ <b>Debit Alert</b>\n\nAmount: ₹${amt}\nTo: ${receiver.name} (${receiver_mobile})\nTxn ID: <code>${txId}</code>\nComment: ${comment||'—'}\nDate: ${dt}\n\nBalance: ₹${sNew.balance}\n⚡ ELITEPAY`);
    if (rNew.tg_id) sendTG(rNew.tg_id, `🎉 <b>Credit Alert</b>\n\nAmount: ₹${amt}\nFrom: ${sender.name} (${sender.mobile})\nTxn ID: <code>${txId}</code>\nComment: ${comment||'—'}\nDate: ${dt}\n\nBalance: ₹${rNew.balance}\n🎉 ELITEPAY`);
    res.json({ status:'success', tx_id:txId, amount:amt, receiver:{ name:receiver.name, mobile:receiver.mobile } });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Bulk Send
router.post('/bulk-send', auth, async (req, res) => {
  try {
    const { mobiles, amount, comment } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status:'error', message:'Minimum ₹1' });
    const uniqueMobiles = [...new Set(mobiles.map(m => m.toString().trim()).filter(m => m.length >= 10))];
    const totalAmt = Math.round(amt * uniqueMobiles.length * 100) / 100;
    const sender = await User.findById(req.user.id);
    if (sender.balance < totalAmt) return res.status(400).json({ status:'error', message:`Insufficient balance. Need ₹${totalAmt}` });
    const now = new Date(); const dt = getIST();
    const results = []; const failed = []; let totalSent = 0;
    for (const mobile of uniqueMobiles) {
      if (mobile === sender.mobile) { failed.push({ mobile, reason:'Cannot send to yourself' }); continue; }
      const receiver = await User.findOne({ mobile });
      if (!receiver) { failed.push({ mobile, reason:'User not found' }); continue; }
      const txId = 'EP' + Date.now().toString().slice(-8);
      await User.findByIdAndUpdate(sender._id,   { $inc:{ balance:-amt } });
      await User.findByIdAndUpdate(receiver._id, { $inc:{ balance:+amt } });
      await Transaction.create({ tx_id:txId, sender_id:sender._id, receiver_id:receiver._id, amount:amt, type:'transfer', status:'success', remark:comment||'Bulk Transfer', tx_time:now });
      totalSent += amt;
      results.push({ mobile, name:receiver.name, tx_id:txId });
      const rNew = await User.findById(receiver._id).select('tg_id balance');
      if (rNew?.tg_id) sendTG(rNew.tg_id, `🎉 <b>Credit Alert</b>\n\nAmount: ₹${amt}\nFrom: ${sender.name}\nTxn ID: <code>${txId}</code>\nDate: ${dt}\n\nBalance: ₹${rNew.balance}\n🎉 ELITEPAY`);
    }
    const sNew = await User.findById(sender._id).select('tg_id balance');
    if (sNew?.tg_id) sendTG(sNew.tg_id, `⚡ <b>Bulk Debit Alert</b>\n\nTotal: ₹${totalSent.toFixed(2)}\nRecipients: ${results.length}\nDate: ${dt}\n\nBalance: ₹${sNew.balance}\n⚡ ELITEPAY`);
    res.json({ status:'success', total_sent:totalSent, success:results.length, failed_count:failed.length, results, failed });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;
