// Default homepage CMS content (seeded on first access)

const localized = (en, rw = '', fr = '') => ({ en, rw, fr });

export function getDefaultHomepageContent() {
  return {
    key: 'homepage',
    testimonialBackgroundUrl: '/testmonial.webp',
    features: [
      {
        id: 'feature-1',
        badge: localized(
          'Services & Stock',
          'Serivisi & Stoki',
          'Services et stock'
        ),
        description: localized(
          'Manage your services, products, and stock levels from one dashboard. Add items, track inventory, and stay on top of what you sell.',
          "Yobora serivisi, ibicuruzwa, n'uburyo stoki ikagenda mu dashibodi imwe. Ongeraho ibintu, kureba stoki, kandi umenye ibyo ugurisha.",
          'Gérez vos services, produits et stocks depuis un seul tableau de bord.'
        ),
        color: 'blue',
        enabled: true,
        order: 0,
      },
      {
        id: 'feature-2',
        badge: localized(
          'Sales & Expenses',
          'Ubucuruzi & Amafaranga',
          'Ventes et dépenses'
        ),
        description: localized(
          'Record sales, log expenses, and see revenue and profit on your dashboard. Know exactly how your business is performing each day.',
          "Andika ubucuruzi, andika amafaranga yakoreshejwe, kandi urebe amafaranga yinjiza n'inyungu ku dashibodi.",
          'Enregistrez ventes et dépenses et suivez revenus et bénéfices sur votre tableau de bord.'
        ),
        color: 'green',
        enabled: true,
        order: 1,
      },
      {
        id: 'feature-3',
        badge: localized(
          'Workers & Reports',
          'Abakozi & Raporo',
          'Équipe et rapports'
        ),
        description: localized(
          'Manage your workers, view sales and expense reports, and export insights to understand trends and grow your business.',
          'Yobora abakozi bawe, reba raporo z\'ubucuruzi n\'amafaranga, kandi ukurebe imiterere kugirango ukure ubucuruzi bwawe.',
          'Gérez votre équipe, consultez les rapports et exportez des analyses pour faire grandir votre activité.'
        ),
        color: 'purple',
        enabled: true,
        order: 2,
      },
      {
        id: 'feature-4',
        badge: localized(
          'Billing & Offline',
          'Kwishyura & Nta interineti',
          'Facturation et hors ligne'
        ),
        description: localized(
          'Subscribe with MTN MoMo or Airtel Money. Keep working offline and your data syncs automatically when you are back online.',
          'Iyandikishe ukoresheje MTN MoMo cyangwa Airtel Money. Komeza ukora nta interineti — amakuru yawe ahuzwa mu buryo bwikora.',
          'Abonnez-vous via MTN MoMo ou Airtel Money. Travaillez hors ligne ; vos données se synchronisent automatiquement.'
        ),
        color: 'orange',
        enabled: true,
        order: 3,
      },
    ],
    testimonials: [
      {
        id: 'testimonial-1',
        quote: localized(
          'Trippo helps me track every service and sale at my salon. I manage workers, see daily revenue on the dashboard, and finally know where my money goes.',
          'Trippo imfasha gukurikirana serivisi n\'ubucuruzi mu iduka ryanjye. Nyobora abakozi, mbona amafaranga yinjira buri munsi ku dashibodi.',
          'Trippo m\'aide à suivre chaque service et vente dans mon salon.'
        ),
        attribution: localized(
          'Claudine Mukamana · Kigali',
          'Claudine Mukamana · Kigali',
          'Claudine Mukamana · Kigali'
        ),
        enabled: true,
        order: 0,
      },
      {
        id: 'testimonial-2',
        quote: localized(
          'We moved from notebooks to Trippo for sales and expenses. The reports show what sells best each week — it saves us hours every month.',
          'Twavuye mu bitabo tujya kuri Trippo kubucuruzi n\'amafaranga. Raporo ziratwereka ibyo bigurishwa cyane buri cyumweru.',
          'Nous sommes passés des cahiers à Trippo pour les ventes et dépenses.'
        ),
        attribution: localized(
          'Jean Bosco Niyonzima · Nyamirambo',
          'Jean Bosco Niyonzima · Nyamirambo',
          'Jean Bosco Niyonzima · Nyamirambo'
        ),
        enabled: true,
        order: 1,
      },
      {
        id: 'testimonial-3',
        quote: localized(
          'Paying for Plus with MoMo was easy. Even when internet drops, I record sales offline and everything syncs when we are back online.',
          'Kwishyura Plus na MoMo byoroshye. N\'igihe interineti igenda, ndakomeza kwandika ubucuruzi nta interineti.',
          'Payer Plus avec MoMo était simple. Même sans internet, je synchronise ensuite.'
        ),
        attribution: localized(
          'Espérance Uwase · Remera',
          'Espérance Uwase · Remera',
          'Espérance Uwase · Remera'
        ),
        enabled: true,
        order: 2,
      },
    ],
    partners: [
      {
        id: 'partner-1',
        name: localized('Lindocare', 'Lindocare', 'Lindocare'),
        logoUrl: '/lindo.png',
        websiteUrl: '',
        enabled: true,
        order: 0,
      },
    ],
    pricingPlans: [
      {
        id: 'plan-basic',
        name: localized('Basic', 'Gisanzwe', 'Basique'),
        price: '$0',
        priceSuffix: localized('/month', '/ukwezi', '/mois'),
        features: [
          localized('Product inventory management', "Gucunga stoki y'ibicuruzwa", 'Gestion des stocks'),
          localized('Sales tracking and recording', "Kureba n'andika ubucuruzi", 'Suivi des ventes'),
          localized('Basic reports and analytics', 'Raporo nshya n\'isesengura', 'Rapports de base'),
          localized('Offline support with sync', 'Gufasha nta interineti hamwe no guhuza', 'Hors ligne avec sync'),
          localized('Up to 100 products', 'Ibicuruzwa bigera kuri 100', "Jusqu'à 100 produits"),
        ],
        ctaLabel: localized('Get Started', 'Tangira', 'Commencer'),
        enabled: true,
        isPlaceholder: false,
        order: 0,
      },
      {
        id: 'plan-pro',
        name: localized('Pro', 'Pro', 'Pro'),
        price: '',
        priceSuffix: localized('/month', '/ukwezi', '/mois'),
        features: [],
        ctaLabel: localized('Subscribe', 'Kwiyandikisha', "S'abonner"),
        enabled: false,
        isPlaceholder: true,
        order: 1,
      },
      {
        id: 'plan-enterprise',
        name: localized('Enterprise', 'Ubucuruzi', 'Entreprise'),
        price: '',
        priceSuffix: localized('/month', '/ukwezi', '/mois'),
        features: [],
        ctaLabel: localized('Subscribe', 'Kwiyandikisha', "S'abonner"),
        enabled: false,
        isPlaceholder: true,
        order: 2,
      },
      {
        id: 'plan-custom',
        name: localized('Custom', 'Bitezimbere', 'Sur mesure'),
        price: '',
        priceSuffix: localized('/month', '/ukwezi', '/mois'),
        features: [],
        ctaLabel: localized('Subscribe', 'Kwiyandikisha', "S'abonner"),
        enabled: false,
        isPlaceholder: true,
        order: 3,
      },
    ],
  };
}

export function pickLocalized(field, lang = 'en') {
  if (!field) return '';
  if (typeof field === 'string') return field;
  const code = ['en', 'rw', 'fr'].includes(lang) ? lang : 'en';
  return field[code] || field.en || field.rw || field.fr || '';
}

export function resolveHomepageForLang(doc, lang = 'en') {
  const pick = (field) => pickLocalized(field, lang);

  const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

  return {
    testimonialBackgroundUrl: doc.testimonialBackgroundUrl || '/testmonial.webp',
    features: (doc.features || [])
      .filter((item) => item.enabled !== false)
      .sort(sortByOrder)
      .map((item) => ({
        id: item.id,
        badge: pick(item.badge),
        description: pick(item.description),
        color: item.color || 'blue',
      })),
    testimonials: (doc.testimonials || [])
      .filter((item) => item.enabled !== false)
      .sort(sortByOrder)
      .map((item) => ({
        id: item.id,
        quote: pick(item.quote),
        attribution: pick(item.attribution),
      })),
    partners: (doc.partners || [])
      .filter((item) => item.enabled !== false)
      .sort(sortByOrder)
      .map((item) => ({
        id: item.id,
        name: pick(item.name),
        logoUrl: item.logoUrl || '',
        websiteUrl: item.websiteUrl || '',
      })),
    pricingPlans: (doc.pricingPlans || [])
      .filter((item) => item.enabled !== false || item.isPlaceholder === true)
      .sort(sortByOrder)
      .map((item) => ({
        id: item.id,
        name: pick(item.name),
        price: item.price || '',
        priceSuffix: pick(item.priceSuffix),
        features: (item.features || []).map((f) => pick(f)).filter(Boolean),
        ctaLabel: pick(item.ctaLabel),
        isPlaceholder: item.isPlaceholder === true,
      })),
  };
}
