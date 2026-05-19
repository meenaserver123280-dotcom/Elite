const mongoose = require('mongoose');

const giftCodeSchema = new mongoose.Schema({
  code:       { type: String, required: true, unique: true },
  amount:     { type: Number, required: true },
  max_uses:   { type: Number, default: 1 },
  used_count: { type: Number, default: 0 },
  used_by:    [{ type: String }],
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expires_at: { type: Date },
  active:     { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('GiftCode', giftCodeSchema);
