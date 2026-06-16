import mongoose from 'mongoose';

const localizedStringSchema = new mongoose.Schema(
  {
    en: { type: String, default: '' },
    rw: { type: String, default: '' },
    fr: { type: String, default: '' },
  },
  { _id: false }
);

const featureSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    badge: { type: localizedStringSchema, default: () => ({}) },
    description: { type: localizedStringSchema, default: () => ({}) },
    color: {
      type: String,
      enum: ['blue', 'green', 'purple', 'orange'],
      default: 'blue',
    },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const testimonialSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    quote: { type: localizedStringSchema, default: () => ({}) },
    attribution: { type: localizedStringSchema, default: () => ({}) },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const partnerSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: localizedStringSchema, default: () => ({}) },
    logoUrl: { type: String, default: '' },
    websiteUrl: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const pricingPlanSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: localizedStringSchema, default: () => ({}) },
    price: { type: String, default: '' },
    priceSuffix: { type: localizedStringSchema, default: () => ({}) },
    features: { type: [localizedStringSchema], default: [] },
    ctaLabel: { type: localizedStringSchema, default: () => ({}) },
    enabled: { type: Boolean, default: true },
    isPlaceholder: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const homepageContentSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'homepage', index: true },
    testimonialBackgroundUrl: { type: String, default: '/testmonial.webp' },
    features: { type: [featureSchema], default: [] },
    testimonials: { type: [testimonialSchema], default: [] },
    partners: { type: [partnerSchema], default: [] },
    pricingPlans: { type: [pricingPlanSchema], default: [] },
  },
  { timestamps: true }
);

const HomepageContent = mongoose.model('HomepageContent', homepageContentSchema);

export default HomepageContent;
