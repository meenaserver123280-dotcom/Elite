const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('./auth');

const BOT_TOKEN = process.env.BOT_TOKEN  || '';
const ADMIN_TG  = process.env.ADMIN_TG_ID || '';

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

// Balance
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('balance name wallet_id');
    res.json({ status:'success', balance:user.balance, name:user.name, wallet_id:user.wallet_id });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const txns = await Transaction.find({ $or:[{ sender_id:user._id },{ receiver_id:user._id }] })
      .sort({ tx_time:-1 }).limit(50)
      .populate('sender_id','name mobile')
      .populate('receiver_id','name mobile').lean();
    res.json({ status:'success', transactions:txns });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Deposit Info
router.get('/deposit-info', auth, async (req, res) => {
  res.json({ status:'success', upi_id: process.env.UPI_ID || 'elitepay@upi', note:'Send UPI screenshot to admin after payment.' });
});

// Withdraw
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { upi, amount } = req.body;
    const amt = parseFloat(amount);
    if (!upi || isNaN(amt) || amt < 10) return res.status(400).json({ status:'error', message:'Minimum ₹10 withdrawal' });
    const user = await User.findById(req.user.id);
    if (user.balance < amt) return res.status(400).json({ status:'error', message:`Insufficient balance. Available: ₹${user.balance}` });
    const txId = 'EPW' + Date.now().toString().slice(-8);
    await User.findByIdAndUpdate(user._id, { $inc:{ balance:-amt } });
    await Transaction.create({ tx_id:txId, sender_id:user._id, amount:amt, type:'withdraw', status:'pending', remark:`Withdraw to ${upi}`, tx_time:new Date() });
    if (user.tg_id) sendTG(user.tg_id, `⏳ <b>Withdrawal Request!</b>\n\nAmount: ₹${amt}\nUPI: ${upi}\nTxn ID: <code>${txId}</code>\nDate: ${getIST()}\n\nAdmin 48h mein process karega.\n⚡ ELITEPAY`);
    if (ADMIN_TG) sendTG(ADMIN_TG, `💸 <b>Withdrawal Request!</b>\n\nUser: ${user.name} (${user.mobile})\nAmount: ₹${amt}\nUPI: ${upi}\nTxn ID: <code>${txId}</code>\nDate: ${getIST()}\n\n⚡ ELITEPAY`);
    res.json({ status:'success', tx_id:txId, message:'Withdrawal request submitted!' });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;
