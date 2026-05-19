const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(e => console.error('DB error:', e.message));

// Routes
const { router: authRouter } = require('./routes/auth');
app.use('/auth',     authRouter);
app.use('/transfer', require('./routes/transfer'));
app.use('/wallet',   require('./routes/wallet'));
app.use('/payment',  require('./routes/payment'));
app.use('/lifafa',   require('./routes/lifafa'));
app.use('/gift',     require('./routes/giftcode'));

// Health
app.get('/health', (req, res) => res.json({ status:'ok', time: new Date().toISOString() }));

module.exports = app;
