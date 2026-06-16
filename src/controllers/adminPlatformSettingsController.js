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
      currentPin,
      adminEmail,
      newPin,
      confirmNewPin,
      subscriptionAmount,
      trialDays,
      supportEmail,
      supportPhone,
      whatsappNumber,
      instagramUrl,
      companyName,
      maintenanceMode,
    } = req.body;

    if (!currentPin || String(currentPin).length !== 4) {
      return res.status(400).json({ error: 'Current PIN is required to save settings' });
    }

    const doc = await updatePlatformSettings(
      {
        adminEmail,
        newPin,
        confirmNewPin,
        subscriptionAmount,
        trialDays,
        supportEmail,
        supportPhone,
        whatsappNumber,
        instagramUrl,
        companyName,
        maintenanceMode,
      },
      currentPin,
    );

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
