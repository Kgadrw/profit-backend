// Inventory Model
import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Inventory name is required'],
    trim: true,
    maxlength: 200,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
}, {
  timestamps: true,
});

inventorySchema.index({ userId: 1, name: 1 }, { unique: true });

const Inventory = mongoose.model('Inventory', inventorySchema);

export default Inventory;
