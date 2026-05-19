const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  mobile:    { type: String, required: true, unique: true },
  password:  { type: String, required: true },
  pin:       { type: String, default: '0000', select: false },
  pin_set:   { type: Boolean, default: false },
  tg_id:     { type: String, default: '' },
  wallet_id: { type: String, unique: true },
  api_key:   { type: String, unique: true },
  balance:   { type: Number, default: 0 },
  banned:    { type: Boolean, default: false },
  ban_reason:{ type: String, default: '' },
  last_login:{ type: Date }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = async function(pass) {
  return await bcrypt.compare(pass, this.password);
};

module.exports = mongoose.model('User', userSchema);
