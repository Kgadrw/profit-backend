// User Model
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true, // Allows multiple documents to have no email
    validate: {
      validator: function(v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  businessName: {
    type: String,
    trim: true,
    default: '',
  },
  pin: {
    type: String,
    required: [true, 'PIN is required'],
    minlength: 4,
    maxlength: 4,
  },
}, {
  timestamps: true,
});

// Hash PIN before saving
userSchema.pre('save', async function(next) {
  // Only hash the PIN if it has been modified (or is new)
  if (!this.isModified('pin')) {
    return next();
  }

  try {
    // Hash the PIN
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare PIN
userSchema.methods.comparePin = async function(candidatePin) {
  return await bcrypt.compare(candidatePin, this.pin);
};

// Method to get user without sensitive data
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.pin;
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User;
