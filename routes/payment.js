const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');

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

// GET /payment?key=&to=&amt=&remark=
router.get('/', async (req, res) => {
  try {
    const { key, to, amt, remark, txn } = req.query;
    if (!key || !to || !amt) return res.status(400).json({ status:'error', message:'key, to, amt required' });
    const amount = Math.round(parseFloat(amt) * 100) / 100;
    if (isNaN(amount) || amount < 1) return res.status(400).json({ status:'error', message:'Invalid amount' });
    const sender = await User.findOne({ api_key:key });
    if (!sender) return res.status(401).json({ status:'error', message:'Invalid API key' });
    if (sender.banned) return res.status(403).json({ status:'error', message:'Account banned' });
    const receiver = await User.findOne({ mobile:to });
    if (!receiver) return res.status(404).json({ status:'error', message:`Receiver ${to} not found` });
    if (receiver._id.equals(sender._id)) return res.status(400).json({ status:'error', message:'Cannot send to yourself' });
    if (sender.balance < amount) return res.status(400).json({ status:'error', message:`Insufficient balance. Available: ₹${sender.balance}` });
    if (txn) {
      const dup = await Transaction.findOne({ remark:`API_TXN_${txn}` });
      if (dup) return res.status(400).json({ status:'error', message:'Duplicate transaction' });
    }
    const txId = 'EPA' + Date.now().toString().slice(-8);
    const now  = new Date(); const dt = getIST();
    await User.findByIdAndUpdate(sender._id,   { $inc:{ balance:-amount } });
    await User.findByIdAndUpdate(receiver._id, { $inc:{ balance:+amount } });
    await Transaction.create({ tx_id:txId, sender_id:sender._id, receiver_id:receiver._id, amount, type:'api_transfer', status:'success', remark:txn ? `API_TXN_${txn}` : (remark||'API Transfer'), tx_time:now });
    const sNew = await User.findById(sender._id).select('balance tg_id');
    const rNew = await User.findById(receiver._id).select('balance tg_id');
    if (sNew.tg_id) sendTG(sNew.tg_id, `⚡ <b>API Debit Alert</b>\n\nAmount: ₹${amount}\nTo: ${receiver.name} (${to})\nTxn ID: <code>${txId}</code>\nDate: ${dt}\n\nBalance: ₹${sNew.balance}\n⚡ ELITEPAY`);
    if (rNew.tg_id) sendTG(rNew.tg_id, `🎉 <b>API Credit Alert</b>\n\nAmount: ₹${amount}\nFrom: ${sender.name}\nTxn ID: <code>${txId}</code>\nDate: ${dt}\n\nBalance: ₹${rNew.balance}\n🎉 ELITEPAY`);
    res.json({ status:'success', message:'Transfer Done', amount, txn:txId, tx_id:txId });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Balance Check
router.get('/balance', async (req, res) => {
  try {
    const { key } = req.query;
    const user = await User.findOne({ api_key:key });
    if (!user) return res.status(401).json({ status:'error', message:'Invalid API key' });
    res.json({ status:'success', balance:user.balance, name:user.name });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Verify User
router.get('/verify', async (req, res) => {
  try {
    const { key, mobile } = req.query;
    const sender = await User.findOne({ api_key:key });
    if (!sender) return res.status(401).json({ status:'error', message:'Invalid API key' });
    const user = await User.findOne({ mobile }).select('name mobile wallet_id');
    if (!user) return res.json({ status:'error', message:'User not found' });
    res.json({ status:'success', name:user.name, mobile:user.mobile, wallet_id:user.wallet_id });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;
