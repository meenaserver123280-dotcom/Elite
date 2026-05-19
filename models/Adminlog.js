const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
  action:  { type: String, required: true },
  target:  { type: String },
  detail:  { type: String },
  amount:  { type: Number, default: 0 },
  at:      { type: Date, default: Date.now }
});

module.exports = mongoose.model('AdminLog', adminLogSchema);
