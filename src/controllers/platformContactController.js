import {
  getPlatformSettingsDocument,
  serializePlatformContactForPublic,
} from '../utils/platformSettings.js';

export const getPublicPlatformContact = async (req, res) => {
  try {
    const doc = await getPlatformSettingsDocument();
    res.json({ data: serializePlatformContactForPublic(doc) });
  } catch (error) {
    console.error('Get public platform contact error:', error);
    res.status(500).json({ error: 'Failed to load contact information' });
  }
};
