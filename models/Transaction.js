const mongoose = require('mongoose');

const txnSchema = new mongoose.Schema({
  tx_id:       { type: String },
  sender_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount:      { type: Number, required: true },
  type:        { type: String, default: 'transfer' },
  status:      { type: String, default: 'success' },
  remark:      { type: String, default: '' },
  tx_time:     { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', txnSchema);
