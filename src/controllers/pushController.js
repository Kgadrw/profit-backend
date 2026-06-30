import PushSubscription from '../models/PushSubscription.js';
import { getVapidPublicKey } from '../utils/pushNotifications.js';

export const getPushVapidPublicKey = async (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: 'Push notifications are not configured on this server' });
  }
  res.json({ publicKey });
};

export const subscribePush = async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription payload' });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId: req.user._id,
        endpoint,
        keys: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        userAgent: req.get('user-agent') || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ message: 'Push subscription saved' });
  } catch (error) {
    console.error('Subscribe push error:', error);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
};

export const unsubscribePush = async (req, res) => {
  try {
    const { endpoint } = req.body || {};

    if (endpoint) {
      await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    } else {
      await PushSubscription.deleteMany({ userId: req.user._id });
    }

    res.json({ message: 'Push subscription removed' });
  } catch (error) {
    console.error('Unsubscribe push error:', error);
    res.status(500).json({ error: 'Failed to remove push subscription' });
  }
};
