const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'elitepay_secret_2026';
const BOT_TOKEN  = process.env.BOT_TOKEN  || '';
const ADMIN_TG   = process.env.ADMIN_TG_ID || '';

const otpStore    = {};
const pinOtpStore = {};

const getIST = () => new Date().toLocaleString('en-IN', {
  timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
  year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
});

async function sendTG(chat_id, text) {
  if (!chat_id || !BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id, text, parse_mode:'HTML' })
    });
  } catch(e) {}
}

function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ status:'error', message:'No token' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) { res.status(401).json({ status:'error', message:'Invalid token' }); }
}

// Send OTP
router.post('/send-otp', async (req, res) => {
  try {
    const { tg_id } = req.body;
    if (!tg_id) return res.status(400).json({ status:'error', message:'Telegram ID required' });
    const existing = await User.findOne({ tg_id });
    if (existing) return res.status(400).json({ status:'error', message:'Ye Telegram ID pehle se registered hai!' });
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore[tg_id] = { otp, expires: Date.now() + 5 * 60 * 1000 };
    await sendTG(tg_id,
      `👋 <b>Welcome to ElitePay!</b>\n\n` +
      `🔐 <b>OTP = ${otp}</b>\n\n` +
      `Valid for 5 minutes.\n` +
      `Sent at: ${getIST()}\n\n` +
      `⚡ <b>ELITEPAY</b>`
    );
    res.json({ status:'success', message:'OTP sent!' });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, mobile, password, pin, tg_id, otp } = req.body;
    if (!name || !mobile || !password || !tg_id || !otp)
      return res.status(400).json({ status:'error', message:'All fields required' });
    const stored = otpStore[tg_id];
    if (!stored) return res.status(400).json({ status:'error', message:'OTP send karein pehle!' });
    if (Date.now() > stored.expires) return res.status(400).json({ status:'error', message:'OTP expired!' });
    if (stored.otp !== otp.toString()) return res.status(400).json({ status:'error', message:'Wrong OTP!' });
    delete otpStore[tg_id];
    const exists = await User.findOne({ $or: [{ mobile }, { tg_id }] });
    if (exists) return res.status(400).json({ status:'error', message:'Mobile or TG ID already exists!' });
    const wallet_id = 'EP' + Date.now().toString().slice(-6);
    const api_key   = 'EP-' + Math.random().toString(36).substr(2, 12).toUpperCase();
    const user = await User.create({ name, mobile, password, pin: pin || '0000', pin_set:false, tg_id, wallet_id, api_key, balance:0 });
    const token = jwt.sign({ id:user._id }, JWT_SECRET, { expiresIn:'30d' });
    await sendTG(tg_id,
      `✅ <b>Account Created!</b>\n\n` +
      `👤 Name: <b>${name}</b>\n` +
      `📱 Mobile: <b>${mobile}</b>\n` +
      `💼 Wallet: <b>${wallet_id}</b>\n\n` +
      `⚡ <b>ELITEPAY</b>`
    );
    if (ADMIN_TG) sendTG(ADMIN_TG,
      `🆕 <b>New User!</b>\n👤 ${name}\n📱 ${mobile}\n⏰ ${getIST()}\n\n⚡ <b>ELITEPAY</b>`
    );
    res.json({ status:'success', token, user:{ id:user._id, name:user.name, mobile:user.mobile, wallet_id:user.wallet_id, api_key:user.api_key, balance:user.balance, tg_id:user.tg_id, pin_set:false } });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;
    const user = await User.findOne({ mobile });
    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ status:'error', message:'Invalid credentials' });
    if (user.banned) return res.status(403).json({ status:'error', message:'Account banned. Contact support.' });
    const token = jwt.sign({ id:user._id }, JWT_SECRET, { expiresIn:'30d' });
    await User.findByIdAndUpdate(user._id, { last_login: new Date() });
    if (user.tg_id) sendTG(user.tg_id,
      `🔐 <b>ElitePay Login Alert!</b>\n\n📱 Mobile: <b>${mobile}</b>\n⏰ Time: <b>${getIST()}</b>\n\nAgar ye aap nahi hain, password badlein!\n\n⚡ <b>ELITEPAY</b>`
    );
    res.json({ status:'success', token, user:{ id:user._id, name:user.name, mobile:user.mobile, wallet_id:user.wallet_id, api_key:user.api_key, balance:user.balance, tg_id:user.tg_id, pin_set:user.pin_set } });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// Set PIN
router.post('/set-pin', auth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.toString().length !== 4) return res.status(400).json({ message:'4 digit PIN required' });
    await User.findByIdAndUpdate(req.user.id, { pin:pin.toString(), pin_set:true });
    res.json({ status:'success', message:'PIN set successfully' });
  } catch(e) { res.status(500).json({ message:e.message }); }
});

// Verify PIN
router.post('/verify-pin', auth, async (req, res) => {
  try {
    const { pin } = req.body;
    const user = await User.findById(req.user.id).select('+pin');
    if (user.pin !== pin.toString()) return res.status(401).json({ status:'error', message:'Wrong PIN' });
    res.json({ status:'success' });
  } catch(e) { res.status(500).json({ message:e.message }); }
});

// Change PIN
router.post('/change-pin', auth, async (req, res) => {
  try {
    const { new_pin } = req.body;
    await User.findByIdAndUpdate(req.user.id, { pin:new_pin.toString() });
    res.json({ status:'success', message:'PIN changed' });
  } catch(e) { res.status(500).json({ message:e.message }); }
});

// Forgot PIN OTP
router.post('/forgot-pin-otp', async (req, res) => {
  try {
    const { tg_id } = req.body;
    const user = await User.findOne({ tg_id });
    if (!user) return res.status(404).json({ message:'User not found' });
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    pinOtpStore[tg_id] = { otp, expires: Date.now() + 5 * 60 * 1000 };
    await sendTG(tg_id,
      `🔑 <b>ElitePay PIN Reset OTP</b>\n\n🔢 OTP = <b>${otp}</b>\nValid for 5 mins.\n\n⚡ <b>ELITEPAY</b>`
    );
    res.json({ status:'success', message:'OTP sent' });
  } catch(e) { res.status(500).json({ message:e.message }); }
});

// Reset PIN
router.post('/reset-pin', async (req, res) => {
  try {
    const { tg_id, new_pin, otp } = req.body;
    const stored = pinOtpStore[tg_id];
    if (!stored || stored.otp !== otp.toString() || Date.now() > stored.expires)
      return res.status(400).json({ message:'Invalid or Expired OTP' });
    await User.findOneAndUpdate({ tg_id }, { pin:new_pin.toString(), pin_set:true });
    delete pinOtpStore[tg_id];
    await sendTG(tg_id, `✅ <b>PIN Reset Success!</b>\n\nTime: ${getIST()}\n\n⚡ <b>ELITEPAY</b>`);
    res.json({ status:'success', message:'PIN reset success' });
  } catch(e) { res.status(500).json({ message:e.message }); }
});

// Regen API Key
router.post('/regen-key', auth, async (req, res) => {
  const api_key = 'EP-' + Math.random().toString(36).substr(2, 12).toUpperCase();
  await User.findByIdAndUpdate(req.user.id, { api_key });
  res.json({ status:'success', api_key });
});

// Check Mobile
router.post('/check-mobile', async (req, res) => {
  try {
    const { mobile } = req.body;
    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ status:'error', message:'Mobile registered nahi hai!' });
    res.json({ status:'success', tg_id:user.tg_id || '' });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = { router, auth };
