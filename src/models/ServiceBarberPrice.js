// Service-Barber Price Model
import mongoose from 'mongoose';

const serviceBarberPriceSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true,
  },
  barberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Barber',
    required: true,
  },
  fixedAmount: {
    type: Number,
    required: [true, 'Fixed amount is required'],
    min: [0, 'Fixed amount must be positive'],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

// Index for faster queries - ensure unique service-barber combination per user
serviceBarberPriceSchema.index({ userId: 1, serviceId: 1, barberId: 1 }, { unique: true });
serviceBarberPriceSchema.index({ userId: 1, serviceId: 1 });
serviceBarberPriceSchema.index({ userId: 1, barberId: 1 });

const ServiceBarberPrice = mongoose.model('ServiceBarberPrice', serviceBarberPriceSchema);

export default ServiceBarberPrice;
