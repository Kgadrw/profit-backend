import HomepageContent from '../models/HomepageContent.js';
import {
  getDefaultHomepageContent,
  resolveHomepageForLang,
} from '../utils/homepageDefaults.js';

async function getOrCreateHomepageDoc() {
  let doc = await HomepageContent.findOne({ key: 'homepage' }).lean();
  if (!doc) {
    const created = await HomepageContent.create(getDefaultHomepageContent());
    doc = created.toObject();
  }
  return doc;
}

export const getPublicHomepage = async (req, res) => {
  try {
    const lang = String(req.query.lang || 'en').toLowerCase();
    const doc = await getOrCreateHomepageDoc();
    res.json({ data: resolveHomepageForLang(doc, lang) });
  } catch (error) {
    console.error('Get public homepage error:', error);
    res.status(500).json({ error: 'Failed to load homepage content' });
  }
};

export const getAdminHomepage = async (req, res) => {
  try {
    const doc = await getOrCreateHomepageDoc();
    res.json({ data: doc });
  } catch (error) {
    console.error('Get admin homepage error:', error);
    res.status(500).json({ error: 'Failed to load homepage content' });
  }
};

export const updateAdminHomepage = async (req, res) => {
  try {
    const {
      testimonialBackgroundUrl,
      features,
      testimonials,
      partners,
      pricingPlans,
    } = req.body || {};

    const payload = {};
    if (testimonialBackgroundUrl !== undefined) {
      payload.testimonialBackgroundUrl = testimonialBackgroundUrl;
    }
    if (Array.isArray(features)) payload.features = features;
    if (Array.isArray(testimonials)) payload.testimonials = testimonials;
    if (Array.isArray(partners)) payload.partners = partners;
    if (Array.isArray(pricingPlans)) payload.pricingPlans = pricingPlans;

    const doc = await HomepageContent.findOneAndUpdate(
      { key: 'homepage' },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({
      message: 'Homepage content updated',
      data: doc,
    });
  } catch (error) {
    console.error('Update admin homepage error:', error);
    res.status(500).json({ error: 'Failed to update homepage content' });
  }
};
