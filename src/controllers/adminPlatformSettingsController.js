import {
  getPlatformSettingsDocument,
  serializePlatformSettingsForAdmin,
  updatePlatformSettings,
} from '../utils/platformSettings.js';

export const getAdminPlatformSettings = async (req, res) => {
  try {
    const doc = await getPlatformSettingsDocument();
    res.json({ data: serializePlatformSettingsForAdmin(doc) });
  } catch (error) {
    console.error('Get admin platform settings error:', error);
    res.status(500).json({ error: error.message || 'Failed to load platform settings' });
  }
};

export const updateAdminPlatformSettings = async (req, res) => {
  try {
    const {
      adminEmail,
      subscriptionAmount,
      trialDays,
      supportEmail,
      supportPhone,
      whatsappNumber,
      instagramUrl,
      companyName,
      maintenanceMode,
    } = req.body;

    const doc = await updatePlatformSettings({
      adminEmail,
      subscriptionAmount,
      trialDays,
      supportEmail,
      supportPhone,
      whatsappNumber,
      instagramUrl,
      companyName,
      maintenanceMode,
    });

    res.json({
      message: 'Platform settings updated',
      data: serializePlatformSettingsForAdmin(doc),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('Update admin platform settings error:', error);
    }
    res.status(status).json({ error: error.message || 'Failed to update platform settings' });
  }
};
