import { htmlText } from './html-text.js';
import { icon } from './icons.js';
const COMPENSATION_DESCRIPTION = 'Bonus marketing de suivi et de satisfaction. Les remboursements de retard sont déclenchés par la politique de compensation Expert, indépendamment de ce service ; aucun remboursement supplémentaire en Simple.';
const rec = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const s = (v, d = '') => typeof v === 'string' ? v : d;
const b = (v, d = false) => typeof v === 'boolean' ? v : d;
const esc = (v) => htmlText(String(v ?? ''));
const euro = (v) => `${Math.round(v).toLocaleString('fr-FR')} €`;
const pct = (v) => `${Math.round(v)} %`;
const fmt = (v, d = 0) => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const stableId = (prefix, name) => `${prefix}_${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}`;
const randId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const dateText = (v) => s(v, new Date().toISOString().slice(0, 10));
const isPassengerService = (v) => ['passager', 'passenger', 'voyageur'].includes(String(rec(v).serviceType || rec(v).category || '').toLowerCase());
const isFreightService = (v) => ['fret', 'freight'].includes(String(rec(v).serviceType || rec(v).category || '').toLowerCase());
const audiences = ['Tous', 'Pendulaires', 'Affaires', 'Loisirs', 'Familles', 'Premium', 'Jeunes', 'Seniors', 'Groupes'];
const campaignAudiences = [...audiences, 'Fret'];
const offerTypes = ['tarif', 'abonnement', 'fidélité', 'service', 'confort', 'promotion'];
const FEEDBACK_NAMES = ['Camille', 'Nina', 'Mathis', 'Jules', 'Sarah', 'Lina', 'Tom', 'Louise', 'Emma', 'Hugo', 'Clara', 'Louis', 'Anaïs', 'Lucas', 'Manon', 'Gabriel', 'Chloé', 'Arthur'];
const PRESS_MEDIA = ['Le Rail Hebdo', 'Mobilités Magazine', 'Transports & Territoires', 'Voyager+', 'Le Quotidien Éco', 'Réseaux & Mobilités', 'L’Observateur du Rail', 'Mobilité Business'];
const DEFAULT_OFFERS = [
    ['Carte Week-end', 'tarif', 'Loisirs', 'Réduction sur les voyages de fin de semaine.', -15, 9, 4, false, true],
    ['Pack Famille', 'tarif', 'Familles', 'Prix réduit, placement groupé et souplesse d’échange.', -12, 12, 6, true, true],
    ['Business Flex', 'tarif', 'Affaires', 'Billet modifiable, priorité et conditions flexibles.', 8, 5, 5, true, true],
    ['Tarif Jeune', 'tarif', 'Jeunes', 'Prix allégé pour étudiants et jeunes voyageurs.', -18, 11, 4, false, false],
    ['Tarif Senior', 'tarif', 'Seniors', 'Réduction et assistance facilitée.', -12, 6, 5, false, false],
    ['Mini-groupe', 'tarif', 'Groupes', 'Prix dégressif pour 4 à 9 voyageurs.', -10, 8, 4, false, false],
    ['Groupe 10+', 'tarif', 'Groupes', 'Tarification groupe et réservation centralisée.', -16, 7, 5, false, false],
    ['Dernière minute', 'promotion', 'Tous', 'Remplit les sièges restants avec un prix dynamique.', -20, 10, 2, false, false],
    ['Early Bird', 'promotion', 'Loisirs', 'Récompense les réservations très anticipées.', -14, 9, 3, false, false],
    ['Happy Hours Rail', 'promotion', 'Tous', 'Promotion ciblée sur les trains creux.', -10, 7, 2, false, false],
    ['Abonnement Pendulaire', 'abonnement', 'Pendulaires', 'Forfait mensuel pour trajets récurrents.', -22, 14, 6, false, true],
    ['Pass Réseau', 'abonnement', 'Tous', 'Accès forfaitaire à un large panier de trains.', -9, 9, 5, false, false],
    ['Business Unlimited', 'abonnement', 'Affaires', 'Forfait premium très flexible.', 12, 7, 7, false, false],
    ['Rail Points', 'fidélité', 'Tous', 'Points, bons d’achat et récompenses de fréquence.', 0, 8, 6, true, true],
    ['Statut Gold', 'fidélité', 'Premium', 'Avantages renforcés pour clients très fréquents.', 5, 5, 8, false, false],
    ['Parrainage', 'fidélité', 'Tous', 'Bonus au parrain et au nouveau client.', -5, 10, 4, false, false],
    ['Silence Plus', 'confort', 'Premium', 'Accès garanti à une zone calme.', 5, 3, 7, false, false],
    ['Famille Zen', 'confort', 'Familles', 'Zone famille et kit enfant.', 3, 4, 8, false, false],
    ['Siège garanti', 'service', 'Pendulaires', 'Option de place assise garantie.', 6, 4, 7, false, false],
    ['Bagage Plus', 'service', 'Loisirs', 'Bagage supplémentaire et emplacement réservé.', 4, 3, 4, false, false],
    ['Vélo à bord', 'service', 'Loisirs', 'Réservation d’un emplacement vélo.', 3, 3, 5, false, false],
    ['Assistance Premium', 'service', 'Premium', 'Accompagnement personnalisé avant et pendant le voyage.', 12, 2, 9, false, false],
    ['Correspondance Sérénité', 'service', 'Tous', 'Protection commerciale en cas de correspondance manquée.', 4, 5, 8, false, false],
    ['Offre Événement', 'promotion', 'Loisirs', 'Pack train + avantage lors d’un événement.', -8, 8, 5, false, false],
].map((x) => ({ name: x[0], type: x[1], target: x[2], description: x[3], priceDeltaPct: x[4], demandBoost: x[5], satisfactionBoost: x[6], active: x[7], featured: x[8] }));
const DEFAULT_FOOD = [
    ['Espresso', 'Boissons chaudes', 2.5, .45, 82, false, true, true, true], ['Café allongé', 'Boissons chaudes', 2.9, .55, 82, false, true, true, false], ['Cappuccino', 'Boissons chaudes', 3.7, 1.05, 86, false, true, true, true], ['Thé premium', 'Boissons chaudes', 3.2, .75, 85, false, true, true, false], ['Chocolat chaud', 'Boissons chaudes', 3.6, 1.1, 83, false, true, true, false],
    ['Eau plate 50 cl', 'Boissons froides', 2.3, .4, 78, false, true, true, false], ['Eau gazeuse 50 cl', 'Boissons froides', 2.5, .48, 79, false, true, true, false], ['Jus de pomme local', 'Boissons froides', 3.8, 1.35, 90, true, true, true, false], ['Jus d’orange', 'Boissons froides', 3.6, 1.2, 86, false, true, true, false], ['Cola', 'Boissons froides', 3.4, .9, 77, false, true, true, false],
    ['Croissant pur beurre', 'Petit-déjeuner', 2.6, .8, 87, true, true, true, true], ['Pain au chocolat', 'Petit-déjeuner', 2.8, .9, 86, true, true, true, false], ['Menu petit-déjeuner', 'Petit-déjeuner', 8.9, 3.25, 89, true, false, true, true], ['Granola & yaourt', 'Petit-déjeuner', 5.2, 2.0, 90, true, true, false, false],
    ['Sandwich jambon-beurre', 'Snacks salés', 6.2, 2.15, 82, true, false, true, true], ['Club poulet', 'Snacks salés', 7.9, 3.1, 86, false, false, true, false], ['Wrap végétarien', 'Snacks salés', 7.4, 2.8, 91, true, true, true, false], ['Croque-monsieur', 'Snacks salés', 7.2, 2.6, 84, false, false, false, false], ['Salade César', 'Repas légers', 9.5, 4.0, 87, false, false, true, false], ['Salade veggie locale', 'Repas légers', 9.2, 3.7, 93, true, true, false, false],
    ['Bowl méditerranéen', 'Repas légers', 10.5, 4.4, 92, true, true, false, false], ['Pasta chaude', 'Plats chauds', 11.9, 5.1, 88, false, true, false, false], ['Parmentier du chef', 'Plats chauds', 13.5, 6.0, 92, true, false, false, false], ['Curry végétal', 'Plats chauds', 12.9, 5.5, 94, true, true, false, false],
    ['Menu enfant', 'Famille', 7.5, 2.9, 88, false, false, false, false], ['Compote enfant', 'Famille', 2.2, .65, 86, true, true, false, false], ['Cookie chocolat', 'Desserts', 3.3, .95, 89, true, true, true, true], ['Brownie', 'Desserts', 3.7, 1.15, 87, false, true, true, false], ['Tarte locale', 'Desserts', 4.8, 1.9, 93, true, true, false, false], ['Salade de fruits', 'Desserts', 4.9, 2.05, 92, true, true, false, false],
    ['Plateau Business', 'Premium', 18.5, 8.2, 95, true, false, false, false], ['Petit-déjeuner Premium', 'Premium', 16.0, 6.8, 96, true, false, false, false], ['Box apéritive', 'Premium', 14.5, 6.1, 92, true, false, false, false], ['Menu régional', 'Premium', 19.5, 8.9, 97, true, false, false, false],
].map((x) => ({ name: x[0], category: x[1], price: x[2], cost: x[3], quality: x[4], local: x[5], vegetarian: x[6], active: x[7], bestseller: x[8] }));
const DEFAULT_FEATURES = [
    ['Wi-Fi à bord', 'Digital', 'Accès Wi-Fi voyageurs avec portail captif.', .08, 5, 3, true], ['Prises électriques', 'Confort', 'Prises ou USB à la place.', .025, 3, 1, true], ['Zone calme', 'Confort', 'Espace silencieux identifié et contrôlé.', .03, 4, 1, true], ['Zone familles', 'Famille', 'Espace adapté aux familles et poussettes.', .035, 4, 2, true], ['Accessibilité renforcée', 'Accessibilité', 'Assistance et parcours PMR renforcés.', .05, 5, 1, true], ['Streaming à bord', 'Digital', 'Portail de contenus hors-ligne.', .06, 3, 2, false], ['Commande au siège', 'Restauration', 'Commande depuis le portail Wi-Fi avec livraison.', .10, 5, 2, false], ['Réservation vélo', 'Services', 'Emplacement vélo réservable.', .018, 3, 2, false], ['Espace bagages surveillé', 'Services', 'Zone bagages améliorée et clairement balisée.', .04, 4, 1, false], ['Kit enfant', 'Famille', 'Jeu, coloriage et petite attention.', .12, 5, 2, false], ['Presse numérique', 'Digital', 'Accès presse et magazines durant le trajet.', .035, 3, 1, false], ['Accueil Premium', 'Premium', 'Accueil dédié et petite attention.', .45, 7, 2, false], ['Salon en gare', 'Premium', 'Accès salon selon billet/offre.', .55, 8, 3, false], ['Service à la place', 'Premium', 'Restauration servie directement au siège.', .35, 7, 2, false], ['Info temps réel enrichie', 'Information', 'Correspondances, quai, retard et alternatives.', .02, 6, 2, true], ['Compensation automatique', 'Service client', COMPENSATION_DESCRIPTION, .08, 7, 2, false], ['Objets trouvés express', 'Service client', 'Suivi numérique et restitution accélérée.', .015, 2, 1, false], ['Option animal', 'Services', 'Conditions claires et espace adapté.', .01, 2, 1, false],
].map((x) => ({ name: x[0], category: x[1], description: x[2], costPerPassenger: x[3], satisfactionBoost: x[4], demandBoost: x[5], active: x[6] }));
const DEFAULT_AD_SLOTS = [
    ['Écrans information à bord', 'À bord', 'Écran 16:9', 4200, 30, 'Display'], ['Portail Wi-Fi', 'À bord', 'Bannière / interstitiel', 2800, 30, 'Digital'], ['Tablettes dossier de siège', 'À bord', 'Print', 1800, 30, 'Print'], ['Sets de plateau restauration', 'À bord', 'Print', 950, 30, 'Restauration'], ['Habillage voiture', 'À bord', 'Covering partiel', 12500, 14, 'Branding'], ['Billet numérique', 'Digital', 'Encart confirmation', 3500, 30, 'Digital'], ['Application / espace client', 'Digital', 'Bannière native', 4800, 30, 'Digital'], ['Newsletter voyageurs', 'Digital', 'Bloc sponsorisé', 3200, 14, 'CRM'], ['Infogare / écrans gare', 'Gare', 'Display', 6700, 30, 'Display'], ['Affichage quai', 'Gare', 'Affiche / DOOH', 8200, 30, 'Affichage'], ['Salon Premium', 'Gare', 'Branding discret', 5100, 30, 'Premium'], ['Magazine de bord', 'À bord', 'Page entière', 2900, 30, 'Print'],
].map((x) => ({ name: x[0], placement: x[1], format: x[2], dailyPrice: x[3], contractDays: x[4], category: x[5] }));
const CAMPAIGN_PRESETS = [
    ['Grande campagne nationale', 'TV + Digital', 'Tous', 'Notoriété', 85000, 21, 11, 5, 1], ['Remplir les heures creuses', 'Digital', 'Pendulaires', 'Conversion', 18000, 14, 5, 9, 1], ['Escapades week-end', 'Social + Affichage', 'Loisirs', 'Conversion', 26000, 21, 6, 8, 2], ['Familles en vacances', 'Digital + Presse', 'Familles', 'Lancement offre', 22000, 28, 6, 7, 3], ['Business Rail', 'Presse + LinkedIn', 'Affaires', 'Image de marque', 32000, 30, 7, 5, 3], ['Jeunes à bord', 'Social + Influence', 'Jeunes', 'Acquisition', 16000, 21, 5, 9, 2], ['Montée en gamme', 'Presse + Display', 'Premium', 'Image de marque', 38000, 30, 8, 4, 4], ['Fidélisation clients', 'CRM + E-mail', 'Tous', 'Rétention', 9000, 30, 3, 4, 4], ['Communication verte', 'Presse + Digital', 'Tous', 'Image de marque', 24000, 30, 7, 4, 3], ['Lancement nouvelle ligne', 'TV + Affichage', 'Tous', 'Lancement offre', 65000, 28, 10, 8, 2], ['Prospection chargeurs fret', 'Presse + Digital', 'Fret', 'Acquisition', 28000, 21, 0, 10, 0],
];
const DEFAULT_STATS = { satisfaction: 70, awareness: 50, loyalty: 50, pressScore: 70, averageFeedback: 4, replyRate: 0, activeCampaigns: 0, activeOffers: 0, activeMenuItems: 0, activeFeatures: 0, onboardRevenueToday: 0, onboardCostToday: 0, adRevenueToday: 0, marketingSpendToday: 0, netMarketingToday: 0, dailyPassengers: 0, demandMultiplier: 1, fareMultiplier: 1, lastDay: '' };
function normalizeStats(value) {
    const input = rec(value), result = { ...DEFAULT_STATS };
    for (const field of Object.keys(DEFAULT_STATS)) {
        if (field === 'lastDay')
            result.lastDay = s(input.lastDay).slice(0, 10);
        else
            result[field] = n(input[field], DEFAULT_STATS[field]);
    }
    for (const field of ['satisfaction', 'awareness', 'loyalty', 'pressScore', 'replyRate'])
        result[field] = clamp(result[field], 0, 100);
    result.averageFeedback = clamp(result.averageFeedback, 1, 5);
    for (const field of ['activeCampaigns', 'activeOffers', 'activeMenuItems', 'activeFeatures', 'onboardRevenueToday', 'onboardCostToday', 'adRevenueToday', 'marketingSpendToday', 'dailyPassengers'])
        result[field] = Math.max(0, result[field]);
    return result;
}
export class MarketingManager {
    constructor() {
        this._lastManualActionAt = {};
        this._lastDeliveredQuality = null;
        this._qualityJournalRestored = false;
        this._lastCampaignSatisfaction = 0;
        this._drafts = {};
        this._openDraftForms = {};
        this._simpleAdvertising = true;
        this._adQuotes = {};
        this._adMessage = '';
        this.offers = [];
        this.catering = [];
        this.features = [];
        this.campaigns = [];
        this.adSlots = [];
        this.feedbacks = [];
        this.pressReviews = [];
        this.history = [];
        this.serviceOffers = [];
        this.settings = { farePolicy: 'équilibrée', compensationPolicy: 'équilibrée', loyaltyProgram: 'simple', brandPositioning: 'généraliste', customerCare: 'renforcé', greenCommunication: false };
        this.stats = normalizeStats(null);
        this._lastDailyDate = '';
        this._lastPassengerCount = 0;
        this._lastPassengerArrivalHistoryIndex = 0;
        this._lastDeliveredPunctuality = null;
        this._lastDeliveredAvgDelay = null;
        this._arrivalObservation = null;
        this._lastFreightCount = 0;
        this._lastFreightRevenue = 0;
        this._lastFreightFeedbackCount = 0;
        this._lastFreightFeedbackRevenue = 0;
        this._freightBaselinePending = false;
        this._tab = 'overview';
        this._galleryTrains = [];
        this._currentDay = '';
        this._liveSnapshot = { totalPassengers: 0, dailyPassengers: 0, totalTicketRevenue: 0, totalFreightTonnes: 0, totalFreightRevenue: 0, freightServices: 0, liveFreightServices: 0, freightPunctuality: 100, freightAvgDelay: 0, freightCancelled: 0, freightLoad: 0, passengerSatisfaction: 70, punctuality: 100, avgDelay: 0, cancelled: 0, passengerServices: 0, livePassengerServices: 0, cleanliness: 100, occupancy: 0, cumulativeRevenue: 0, cumulativeExpenses: 0 };
        this._dimensions = { global: 70, punctuality: 100, comfort: 75, cleanliness: 100, catering: 75, value: 75, information: 75, customerCare: 70, digital: 75, brand: 65 };
        this._mergeCatalogs();
        this._recomputeDerived();
    }
    _mergeCatalogs() {
        const addMissing = (current, defs, prefix) => { for (const d of defs) {
            if (current.some(x => x.name === d.name))
                continue;
            current.push({ id: stableId(prefix, d.name), ...d });
        } };
        addMissing(this.offers, DEFAULT_OFFERS, 'offer');
        addMissing(this.catering, DEFAULT_FOOD.map(x => ({ ...x, salesToday: 0 })), 'food');
        addMissing(this.features, DEFAULT_FEATURES, 'feature');
        addMissing(this.adSlots, DEFAULT_AD_SLOTS.map(x => ({ ...x, advertiser: '', daysRemaining: x.contractDays, active: false })), 'ad');
    }
    toSave() { return { schemaVersion: 5, lastDeliveredQuality: this._lastDeliveredQuality, lastCampaignSatisfaction: this._lastCampaignSatisfaction, offers: this.offers, serviceOffers: this.serviceOffers.map(x => ({ ...x, scheduleIds: [...x.scheduleIds] })), catering: this.catering, features: this.features, campaigns: this.campaigns, adSlots: this.adSlots, feedbacks: this.feedbacks, pressReviews: this.pressReviews, settings: this.settings, stats: this.stats, history: this.history, lastDailyDate: this._lastDailyDate, lastPassengerCount: this._lastPassengerCount, lastPassengerArrivalHistoryIndex: this._lastPassengerArrivalHistoryIndex, lastDeliveredPunctuality: this._lastDeliveredPunctuality, lastDeliveredAvgDelay: this._lastDeliveredAvgDelay, lastFreightCount: this._freightBaselinePending ? null : this._lastFreightCount, lastFreightRevenue: this._lastFreightRevenue, lastFreightFeedbackCount: this._freightBaselinePending ? null : this._lastFreightFeedbackCount, lastFreightFeedbackRevenue: this._lastFreightFeedbackRevenue, tab: this._tab }; }
    loadFromSave(data) {
        const x = rec(data);
        this.offers = Array.isArray(x.offers) ? x.offers.map(v => this._normOffer(v)) : [];
        this.serviceOffers = Array.isArray(x.serviceOffers) ? x.serviceOffers.map(v => this._normCommercialOffer(v)) : [];
        this.catering = Array.isArray(x.catering) ? x.catering.map(v => this._normFood(v)) : [];
        this.features = Array.isArray(x.features) ? x.features.map(v => this._normFeature(v)) : [];
        this.campaigns = Array.isArray(x.campaigns) ? x.campaigns.map(v => this._normCampaign(v)) : [];
        this.adSlots = Array.isArray(x.adSlots) ? x.adSlots.map(v => this._normAd(v)) : [];
        this.feedbacks = Array.isArray(x.feedbacks) ? x.feedbacks.map(v => this._normFeedback(v)) : [];
        this.pressReviews = Array.isArray(x.pressReviews) ? x.pressReviews.map(v => this._normPress(v)) : [];
        this.history = Array.isArray(x.history) ? x.history.map(v => this._normHistory(v)).slice(-120) : [];
        const st = rec(x.settings);
        this.settings = { farePolicy: (['éco', 'équilibrée', 'premium'].includes(s(st.farePolicy)) ? s(st.farePolicy) : 'équilibrée'), compensationPolicy: (['minimale', 'équilibrée', 'généreuse'].includes(s(st.compensationPolicy)) ? s(st.compensationPolicy) : 'équilibrée'), loyaltyProgram: (['aucun', 'simple', 'premium'].includes(s(st.loyaltyProgram)) ? s(st.loyaltyProgram) : 'simple'), brandPositioning: (['accessible', 'généraliste', 'premium', 'écologique'].includes(s(st.brandPositioning)) ? s(st.brandPositioning) : 'généraliste'), customerCare: (['standard', 'renforcé', 'excellence'].includes(s(st.customerCare)) ? s(st.customerCare) : 'renforcé'), greenCommunication: b(st.greenCommunication, false) };
        this.stats = normalizeStats(x.stats);
        this._lastDailyDate = s(x.lastDailyDate);
        this._lastPassengerCount = Math.max(0, n(x.lastPassengerCount, 0));
        this._lastPassengerArrivalHistoryIndex = Math.max(0, Math.floor(n(x.lastPassengerArrivalHistoryIndex)));
        this._lastDeliveredPunctuality = x.lastDeliveredPunctuality == null ? null : clamp(n(x.lastDeliveredPunctuality, 100), 0, 100);
        this._lastDeliveredAvgDelay = x.lastDeliveredAvgDelay == null ? null : Math.max(0, n(x.lastDeliveredAvgDelay));
        const quality = rec(x.lastDeliveredQuality), scores = rec(quality.scores);
        const normalized = {};
        for (const field of ['comfortFactor', 'cleanliness', 'restaurantFactor', 'fareRatio', 'informationAvailable'])
            if (typeof scores[field] === 'number' && Number.isFinite(scores[field]))
                normalized[field] = clamp(Number(scores[field]), 0, 100);
        this._lastDeliveredQuality = Object.keys(normalized).length ? { date: s(quality.date, this._lastDailyDate), scores: normalized } : null;
        this._lastCampaignSatisfaction = clamp(n(x.lastCampaignSatisfaction), 0, 30);
        this._arrivalObservation = null;
        this._qualityJournalRestored = false;
        this._drafts = {};
        this._openDraftForms = {};
        this._adMessage = '';
        this._freightBaselinePending = x.lastFreightCount == null;
        this._lastFreightCount = Math.max(0, n(x.lastFreightCount));
        this._lastFreightRevenue = Math.max(0, n(x.lastFreightRevenue));
        this._lastFreightFeedbackCount = Math.max(0, n(x.lastFreightFeedbackCount, this._lastFreightCount));
        this._lastFreightFeedbackRevenue = Math.max(0, n(x.lastFreightFeedbackRevenue, this._lastFreightRevenue));
        const tab = s(x.tab);
        if (['overview', 'freight', 'onboard', 'offers', 'campaigns', 'ads', 'satisfaction', 'feedback', 'press'].includes(tab))
            this._tab = tab;
        this._mergeCatalogs();
        this._recomputeDerived();
    }
    _commercialCategory(value) {
        const text = String(value || '').toLowerCase();
        return ['passager', 'passenger', 'voyageur', 'passenger'].includes(text) || value === 'PASSENGER' ? 'voyageur'
            : ['fret', 'freight'].includes(text) || value === 'FREIGHT' ? 'fret' : null;
    }
    _normCommercialOffer(value) {
        const x = rec(value);
        return { id: s(x.id, randId('commercial')), name: s(x.name, 'Offre commerciale').trim().slice(0, 90) || 'Offre commerciale',
            category: this._commercialCategory(x.category) || 'voyageur', fareDeltaPct: clamp(n(x.fareDeltaPct), -50, 50),
            demandDeltaPct: clamp(n(x.demandDeltaPct), -50, 100), minSpeedKmh: clamp(Math.round(n(x.minSpeedKmh)), 0, 300),
            scheduleIds: [...new Set((Array.isArray(x.scheduleIds) ? x.scheduleIds : []).map(v => s(v).trim()).filter(Boolean))],
            active: b(x.active, true) };
    }
    addCommercialOffer(input) {
        const offer = this._normCommercialOffer({ ...rec(input), id: randId('commercial'), scheduleIds: [] });
        this.serviceOffers.push(offer);
        return offer;
    }
    assignCommercialOffer(offerId, schedule, enabled) {
        const offer = this.serviceOffers.find(x => x.id === offerId);
        if (!offer || !schedule?.id)
            return { ok: false, message: 'Offre ou horaire introuvable.' };
        if (enabled && this._commercialCategory(schedule.category) !== offer.category)
            return { ok: false, message: 'La catégorie de l’horaire ne correspond pas à l’offre.' };
        if (enabled && offer.category === 'fret' && n(schedule.maxSpeed) < offer.minSpeedKmh)
            return { ok: false, message: `Le train doit atteindre ${offer.minSpeedKmh} km/h.` };
        offer.scheduleIds = enabled ? [...new Set([...offer.scheduleIds, schedule.id])] : offer.scheduleIds.filter(id => id !== schedule.id);
        return { ok: true, message: '' };
    }
    _commercialMultiplier(service, kind, category) {
        if (!service)
            return 1;
        const scheduleId = s(service._v2ScheduleId) || s(service.id);
        if (!scheduleId || this._commercialCategory(service.serviceType || service.category) !== category)
            return 1;
        const speed = n(service.rame?.maxSpeed ?? service.maxSpeed);
        const total = this.serviceOffers.filter(o => o.active && o.category === category && o.scheduleIds.includes(scheduleId)
            && (category !== 'fret' || speed >= o.minSpeedKmh)).reduce((sum, o) => sum + o[kind], 0);
        return clamp(1 + total / 100, .5, 2);
    }
    getPassengerDemandMultiplier(service) { this._recomputeDerived(); return clamp(this.stats.demandMultiplier * this._commercialMultiplier(service, 'demandDeltaPct', 'voyageur'), .5, 2); }
    getPassengerFareMultiplier(service) { this._recomputeDerived(); return clamp(this.stats.fareMultiplier * this._commercialMultiplier(service, 'fareDeltaPct', 'voyageur'), .5, 2); }
    getPassengerCompensationRate() { return this.settings.compensationPolicy === 'généreuse' ? .50 : this.settings.compensationPolicy === 'minimale' ? .10 : .25; }
    getFreightDemandMultiplier(service) { const campaignBoost = this.campaigns.filter(x => x.active && x.target === 'Fret').reduce((sum, x) => sum + x.demandGain, 0); return clamp((1 + campaignBoost / 100) * this._commercialMultiplier(service, 'demandDeltaPct', 'fret'), .5, 2); }
    getFreightFareMultiplier(service) { return this._commercialMultiplier(service, 'fareDeltaPct', 'fret'); }
    syncFromGame(game) { this._currentDay = dateText(game._currentDate); this._galleryTrains = this._collectGalleryTrains(game); this._arrivalObservation = this._observedPassengerArrivals(game); this._restoreDeliveredQuality(game); this._syncAdQuotes(game); this._liveSnapshot = this._collectGameStats(game); this._dimensions = this._computeDimensions(this._liveSnapshot); this.stats.satisfaction = this._dimensions.global; this._recomputeDerived(); }
    _observedPassengerArrivals(game, start = this._lastPassengerArrivalHistoryIndex, end) {
        const journal = game.economy.history;
        if (!Array.isArray(journal))
            return null;
        const arrivals = journal.slice(Math.min(start, journal.length), end)
            .map((entry) => rec(entry))
            .filter((row) => row.category === 'voyageurs' && Number(row.passengers) > 0
            && typeof row.delayMinutes === 'number' && Number.isFinite(row.delayMinutes))
            .map((row) => ({ passengers: Number(row.passengers), delayMinutes: Number(row.delayMinutes),
            serviceName: s(row.serviceName), stationName: s(row.stationName), cancelled: row.cancelled === true, reason: s(row.reason), missedConnections: n(row.missedConnections), deniedBoarding: n(row.deniedBoarding), occupancy: n(row.occupancy), informationAvailable: row.informationAvailable == null ? undefined : row.informationAvailable !== false, restaurantFactor: row.restaurantFactor == null ? undefined : n(row.restaurantFactor, 1), cleanliness: row.cleanliness == null ? undefined : n(row.cleanliness, 100), pricePerKm: row.pricePerKm == null ? undefined : n(row.pricePerKm, .12), comfortFactor: row.comfortFactor == null ? undefined : n(row.comfortFactor, 1), fareRatio: row.fareRatio == null ? undefined : n(row.fareRatio, 1) }));
        if (!arrivals.length)
            return null;
        const passengers = arrivals.reduce((sum, row) => sum + row.passengers, 0);
        const onTime = arrivals.reduce((sum, row) => sum + (!row.cancelled && Math.abs(row.delayMinutes) <= 5 ? row.passengers : 0), 0);
        const delayedMinutes = arrivals.reduce((sum, row) => sum + Math.max(0, row.delayMinutes) * row.passengers, 0);
        return { arrivals, passengers, punctuality: onTime / passengers * 100, avgDelay: delayedMinutes / passengers };
    }
    _canSolicit(key) { const last = this._lastManualActionAt[key], now = Date.now(); return last === undefined || now - last >= 2000; }
    _markSolicited(key) { this._lastManualActionAt[key] = Date.now(); }
    solicitFeedback(game, category) {
        const key = `feedback-${category}`;
        if (!this._canSolicit(key))
            return false;
        this.syncFromGame(game);
        const day = dateText(game._currentDate), freight = category === 'fret';
        if (!freight) {
            // Manual solicitation can revisit recorded journeys after daily settlement has consumed its own arrival cursor.
            const journeys = this._observedPassengerArrivals(game, 0)?.arrivals.filter(row => this._hasJourneyEvidence(row)) || [];
            if (journeys.length) {
                const index = this.feedbacks.filter(review => review.date === day && review.origin === 'solicited' && review.experience === 'journey').length;
                this.feedbacks.unshift(this._passengerExperienceFeedback(day, journeys[journeys.length - 1 - index % journeys.length], index, 'solicited'));
                this.feedbacks = this.feedbacks.slice(0, 160);
                this._markSolicited(key);
                this._recomputeDerived();
                return true;
            }
        }
        const activeOffers = this.serviceOffers.filter(offer => offer.active && offer.category === category).length
            + (freight ? 0 : this.offers.filter(offer => offer.active).length);
        const activeCampaigns = this.campaigns.filter(campaign => campaign.active && (freight ? campaign.target === 'Fret' : campaign.target !== 'Fret')).length;
        const hasTraffic = freight ? this._liveSnapshot.totalFreightTonnes > 0 : this._liveSnapshot.totalPassengers > 0;
        const rating = hasTraffic ? clamp(Math.round((freight ? this.stats.awareness + 20 : this.stats.satisfaction) / 20), 1, 5) : 3;
        const subject = freight ? 'fret' : 'voyageurs';
        const surveyIndex = this.feedbacks.filter(review => review.date === day && review.origin === 'solicited' && review.serviceCategory === category).length;
        const opinions = freight ? [
            activeOffers ? `Les ${activeOffers} offres commerciales fret me donnent des éléments à comparer. La clarté des conditions compte avant de confier un chargement.` : 'Je souhaite recevoir une proposition fret précise avant de confier mes marchandises.',
            activeCampaigns ? `Les ${activeCampaigns} campagnes fret attirent mon attention. J’attends une proposition précise avant de confier mes marchandises.` : 'Je souhaite comparer les délais et les capacités proposées pour mon fret.',
            'Je souhaite connaître les capacités proposées et les conditions commerciales avant de choisir un transporteur.'
        ] : [
            activeOffers ? `Les ${activeOffers} offres voyageurs proposées sont à comparer selon les tarifs et les trajets avant de réserver.` : 'J’aimerais connaître les conditions tarifaires et les trajets proposés avant de réserver.',
            activeCampaigns ? `Les ${activeCampaigns} campagnes voyageurs présentent des services à comparer avant de réserver.` : 'Je souhaite comparer les services proposés avant de réserver.',
            `L’image de la compagnie est évaluée à ${this.stats.awareness}/100. Je veux connaître les options avant de voyager.`
        ];
        this.feedbacks.unshift({ id: randId('fb'), date: day, author: freight ? 'Chargeur potentiel (avis simulé)' : 'Voyageur potentiel (avis simulé)', rating,
            category: `Perception de l’offre ${subject}`, title: `Avis sur l’offre ${subject}`,
            message: opinions[surveyIndex % opinions.length],
            sentiment: rating >= 4 ? 'positive' : rating === 3 ? 'mixed' : 'negative', status: 'new', responded: false, responseText: '', serviceName: '', serviceCategory: category, origin: 'solicited' });
        this.feedbacks = this.feedbacks.slice(0, 160);
        this._markSolicited(key);
        this._recomputeDerived();
        return true;
    }
    organizePress(game, category) {
        const key = `press-${category}`;
        if (!this._canSolicit(key))
            return false;
        this.syncFromGame(game);
        const day = dateText(game._currentDate), freight = category === 'fret';
        if (!game.economy?.addExpense?.(25000, 'marketing', freight ? 'Opération presse fret' : 'Opération presse voyageurs'))
            return false;
        const offers = this.serviceOffers.filter(offer => offer.active && offer.category === category).length
            + (freight ? 0 : this.offers.filter(offer => offer.active).length);
        const campaigns = this.campaigns.filter(campaign => campaign.active && (freight ? campaign.target === 'Fret' : campaign.target !== 'Fret')).length;
        const hasTraffic = freight ? this._liveSnapshot.totalFreightTonnes > 0 : this._liveSnapshot.totalPassengers > 0;
        const score = hasTraffic ? clamp(Math.round(this.stats.awareness * .45 + this.stats.satisfaction * .30 + this.stats.loyalty * .25 + 4), 25, 98) : 50;
        const intro = offers
            ? `La compagnie présente ${offers} offre${offers === 1 ? '' : 's'} commerciale${offers === 1 ? '' : 's'} ${freight ? 'fret' : 'voyageurs'} active${offers === 1 ? '' : 's'}`
            : freight ? 'La compagnie présente ses orientations commerciales pour les futurs chargeurs' : 'La compagnie présente sa stratégie pour les futurs voyageurs';
        const campaignText = campaigns ? ` et ${campaigns} campagne${campaigns === 1 ? '' : 's'} en cours` : '';
        this.pressReviews.unshift({ id: randId('press'), date: day, media: this._pick(PRESS_MEDIA, day, `press-sollicited-${this.pressReviews.length}`),
            title: freight ? 'Rail Empire présente sa stratégie fret' : 'Rail Empire présente son offre voyageurs',
            excerpt: `${intro}${campaignText}. Cette communication porte sur la stratégie de la compagnie.`,
            score, tone: hasTraffic ? (score >= 78 ? 'positive' : score >= 58 ? 'mixed' : 'negative') : 'mixed', serviceCategory: category, origin: 'solicited' });
        this.pressReviews = this.pressReviews.slice(0, 60);
        this._markSolicited(key);
        this._recomputeDerived();
        return true;
    }
    dailyUpdate(game, dateStr) {
        const day = s(dateStr);
        if (!day || day === this._lastDailyDate)
            return;
        this.syncFromGame(game);
        const eco = game.economy;
        const totalPassengers = Math.max(0, n(eco.totalPassengers));
        let dailyPax = Math.max(0, totalPassengers - this._lastPassengerCount);
        this._liveSnapshot.dailyPassengers = dailyPax;
        this.stats.dailyPassengers = dailyPax;
        const totalFreightTonnes = Math.max(0, n(eco.totalFreightTonnes));
        const totalFreightRevenue = Math.max(0, n(rec(eco.revenueByCategory).fret));
        if (this._freightBaselinePending) {
            this._lastFreightCount = totalFreightTonnes;
            this._lastFreightRevenue = totalFreightRevenue;
            this._lastFreightFeedbackCount = totalFreightTonnes;
            this._lastFreightFeedbackRevenue = totalFreightRevenue;
            this._freightBaselinePending = false;
        }
        const dailyFreightTonnes = Math.max(0, totalFreightTonnes - this._lastFreightCount);
        const dailyFreightRevenue = Math.max(0, totalFreightRevenue - this._lastFreightRevenue);
        for (const f of this.catering)
            f.salesToday = 0;
        const paidCampaigns = this.campaigns.filter(c => c.active && c.daysRemaining > 0);
        this._lastCampaignSatisfaction = clamp(paidCampaigns.filter(c => c.target !== 'Fret').reduce((sum, c) => sum + c.satisfactionGain, 0), 0, 30);
        let campaignSpend = 0;
        for (const c of this.campaigns) {
            if (!c.active || c.daysRemaining <= 0) {
                c.active = false;
                continue;
            }
            campaignSpend += c.budgetPerDay;
            c.daysRemaining = Math.max(0, c.daysRemaining - 1);
            if (c.daysRemaining === 0)
                c.active = false;
        }
        let adRevenue = 0;
        for (const a of this.adSlots) {
            if (!a.active)
                continue;
            adRevenue += this._simpleAdvertising ? a.dailyPrice : Math.min(a.dailyPrice, this._advertisingQuote(game, a, dailyPax));
            a.daysRemaining = Math.max(0, a.daysRemaining - 1);
            if (a.daysRemaining === 0) {
                a.active = false;
                a.advertiser = '';
                a.daysRemaining = a.contractDays;
            }
        }
        // The ledger books whole euros; rounding must never raise an audience cap.
        adRevenue = this._simpleAdvertising ? Math.round(adRevenue) : Math.floor(adRevenue);
        const menu = this.catering.filter(x => x.active);
        let onboardRevenue = 0, onboardCost = 0;
        if (dailyPax > 0 && menu.length) {
            const quality = menu.reduce((z, x) => z + x.quality, 0) / menu.length;
            const attach = clamp(.08 + menu.length * .008 + (quality - 70) / 500 + Math.max(0, this.stats.satisfaction - 65) / 700, .06, .46);
            const totalPurchases = Math.round(dailyPax * attach);
            const weights = menu.map(x => Math.max(.2, (x.quality / 100) * (x.bestseller ? 1.45 : 1) * (x.local ? 1.08 : 1)));
            const tw = weights.reduce((z, x) => z + x, 0) || 1;
            menu.forEach((item, i) => { const qty = Math.max(0, Math.round(totalPurchases * weights[i] / tw)); item.salesToday = qty; onboardRevenue += qty * item.price; onboardCost += qty * item.cost; });
        }
        const featureCost = dailyPax * this.features.filter(x => x.active).reduce((z, x) => z + x.costPerPassenger, 0);
        const loyaltyCost = dailyPax * (this.settings.loyaltyProgram === 'premium' ? .22 : this.settings.loyaltyProgram === 'simple' ? .08 : 0);
        const careCost = dailyPax * (this.settings.customerCare === 'excellence' ? .12 : this.settings.customerCare === 'renforcé' ? .045 : .015);
        const marketingSpend = campaignSpend + featureCost + loyaltyCost + careCost;
        this.stats.onboardRevenueToday = Math.round(onboardRevenue);
        this.stats.onboardCostToday = Math.round(onboardCost);
        this.stats.adRevenueToday = Math.round(adRevenue);
        this.stats.marketingSpendToday = Math.round(marketingSpend);
        this.stats.netMarketingToday = Math.round(onboardRevenue + adRevenue - onboardCost - marketingSpend);
        this.stats.lastDay = day;
        if (campaignSpend > 0)
            game.economy?.addExpense?.(Math.round(campaignSpend), 'marketing', `Campagnes marketing ${day}`);
        if (featureCost + loyaltyCost + careCost > 0)
            game.economy?.addExpense?.(Math.round(featureCost + loyaltyCost + careCost), 'service_client', `Services voyageurs & fidélité ${day}`);
        if (onboardCost > 0)
            game.economy?.addExpense?.(Math.round(onboardCost), 'restauration', `Coût restauration à bord ${day}`);
        if (onboardRevenue > 0)
            game.economy?.addRevenue?.(Math.round(onboardRevenue), 'restauration', `Ventes restauration à bord ${day}`);
        if (adRevenue > 0)
            game.economy?.addRevenue?.(Math.round(adRevenue), 'publicite', `Recettes publicitaires ${day}`);
        const campLift = paidCampaigns.filter(x => x.target !== 'Fret').reduce((z, x) => z + x.awarenessGain, 0);
        this.stats.awareness = clamp(Math.round(this.stats.awareness * .94 + 4 + campLift * .7 + Math.min(8, dailyPax / 1200) + (this.settings.greenCommunication ? 1 : 0)), 10, 100);
        this.stats.loyalty = clamp(Math.round(this.stats.loyalty * .86 + this.stats.satisfaction * .13 + (this.settings.loyaltyProgram === 'premium' ? 6 : this.settings.loyaltyProgram === 'simple' ? 3 : 0)), 5, 100);
        if (dailyPax > 0 || this._arrivalObservation?.arrivals.some(row => row.cancelled))
            this._generateFeedback(day, game, Math.max(1, Math.min(6, Math.round(dailyPax / 700) + 1)));
        if (dailyFreightTonnes > 0)
            this._generateFreightFeedback(day, game);
        if (dailyPax > 0 && (this.history.length === 0 || this._dayHash(day, 'press') < .34))
            this._generatePress(day, game);
        if (dailyFreightTonnes > 0 && (!this.pressReviews.some(review => review.serviceCategory === 'fret' && review.origin !== 'solicited') || this._dayHash(day, 'press-fret') < .34))
            this._generateFreightPress(day, game, false, dailyFreightTonnes, dailyFreightRevenue);
        this._recomputeDerived();
        this._dimensions = this._computeDimensions(this._liveSnapshot);
        this.stats.satisfaction = this._dimensions.global;
        this.history.push({ date: day, passengers: dailyPax, satisfaction: this.stats.satisfaction, awareness: this.stats.awareness, loyalty: this.stats.loyalty, punctuality: this._liveSnapshot.punctuality, cateringRevenue: Math.round(onboardRevenue), adRevenue: Math.round(adRevenue), spend: Math.round(onboardCost + marketingSpend), net: this.stats.netMarketingToday });
        this.history = this.history.slice(-120);
        if (this._arrivalObservation) {
            this._rememberDeliveredQuality(day);
            this._lastDeliveredPunctuality = this._arrivalObservation.punctuality;
            this._lastDeliveredAvgDelay = this._arrivalObservation.avgDelay;
        }
        if (Array.isArray(game.economy?.history))
            this._lastPassengerArrivalHistoryIndex = game.economy.history.length;
        this._lastPassengerCount = totalPassengers;
        this._lastFreightCount = totalFreightTonnes;
        this._lastFreightRevenue = totalFreightRevenue;
        this._lastDailyDate = day;
    }
    render(container, game, resetForm) {
        if (!container)
            return;
        const scroll = container.scrollTop, focused = container.ownerDocument?.activeElement;
        const focusKey = focused ? this._draftKey(focused) : '';
        const selected = focused;
        const selection = selected && typeof selected.selectionStart === 'number' ? [selected.selectionStart, selected.selectionEnd] : null;
        container.querySelectorAll('input,select,textarea').forEach(node => {
            const key = this._draftKey(node);
            if (key)
                this._drafts[key] = { value: node.value, checked: node.checked === true };
        });
        container.querySelectorAll('details').forEach(node => {
            const form = node.querySelector('form');
            const key = form?.getAttribute('data-mk-form') || (form?.hasAttribute('data-mk-commercial-form') ? 'commercial' : '');
            if (key)
                this._openDraftForms[key] = node.open;
        });
        if (resetForm)
            for (const key of Object.keys(this._drafts))
                if (key.startsWith(`form:${resetForm}:`))
                    delete this._drafts[key];
        this.syncFromGame(game);
        container.innerHTML = this._renderPage();
        let focusTarget = null;
        container.querySelectorAll('input,select,textarea').forEach(node => {
            const key = this._draftKey(node), draft = this._drafts[key];
            if (draft) {
                node.value = draft.value;
                if (node instanceof HTMLInputElement && node.type === 'checkbox')
                    node.checked = draft.checked;
            }
            if (key === focusKey)
                focusTarget = node;
        });
        container.querySelectorAll('details').forEach(node => {
            const form = node.querySelector('form');
            const key = form?.getAttribute('data-mk-form') || (form?.hasAttribute('data-mk-commercial-form') ? 'commercial' : '');
            if (key && this._openDraftForms[key] != null)
                node.open = this._openDraftForms[key];
        });
        this._bind(container, game);
        if (focusTarget && !focusKey.startsWith(`form:${resetForm}:`)) {
            const target = focusTarget;
            target.focus({ preventScroll: true });
            if (selection && typeof target.setSelectionRange === 'function' && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(target.type))
                target.setSelectionRange(selection[0], selection[1]);
        }
        container.scrollTop = scroll;
    }
    _draftKey(node) {
        const form = node.closest('form'), name = node.getAttribute('name');
        if (form && name) {
            const kind = form.getAttribute('data-mk-form') || (form.hasAttribute('data-mk-commercial-form') ? 'commercial' : '');
            if (kind)
                return `form:${kind}:${name}`;
        }
        for (const prefix of ['ad', 'food']) {
            const field = node.getAttribute(`data-${prefix}-field`), id = node.getAttribute('data-id');
            if (field && id)
                return `${prefix}:${id}:${field}`;
        }
        return '';
    }
    _rememberDeliveredQuality(day) {
        if (!this._arrivalObservation)
            return;
        const scores = { ...this._lastDeliveredQuality?.scores };
        const conversions = {
            comfortFactor: (value, row) => 85 * Number(value) - Math.max(0, Number(row.occupancy || 0) - .85) * 30,
            cleanliness: value => Number(value), restaurantFactor: value => 100 * Number(value),
            fareRatio: value => 100 - Math.max(0, Number(value) - 1) * 40, informationAvailable: value => value === false ? 0 : 100
        };
        for (const field of Object.keys(conversions)) {
            const score = this._observedScore(field, NaN, conversions[field]);
            if (Number.isFinite(score))
                scores[field] = score;
        }
        if (Object.keys(scores).length)
            this._lastDeliveredQuality = { date: day, scores };
    }
    _restoreDeliveredQuality(game) {
        if (this._lastDeliveredQuality || this._qualityJournalRestored || !this._lastPassengerArrivalHistoryIndex)
            return;
        const journal = game.economy.history;
        if (!Array.isArray(journal))
            return;
        this._qualityJournalRestored = true;
        const end = Math.min(this._lastPassengerArrivalHistoryIndex, journal.length);
        const lastTraffic = [...this.history].reverse().find(row => row.passengers > 0);
        const expected = lastTraffic?.passengers || 1;
        let start = end, passengers = 0;
        while (start > 0 && passengers < expected) {
            const row = rec(journal[--start]);
            if (row.category === 'voyageurs' && n(row.passengers) > 0 && typeof row.delayMinutes === 'number')
                passengers += n(row.passengers);
        }
        const pending = this._arrivalObservation;
        this._arrivalObservation = this._observedPassengerArrivals(game, start, end);
        this._rememberDeliveredQuality(lastTraffic?.date || this._lastDailyDate);
        this._arrivalObservation = pending;
    }
    _advertisingQuote(game, slot, passengers) {
        if (!(passengers > 0))
            return 0;
        if (slot.placement === 'À bord' && !(game.rameManager?.getAll?.() || []).some((rame) => n(rec(rame).totalCapacity) > 0))
            return 0;
        if (slot.placement === 'Gare' && !(game.scheduleCreator?.services || []).some(service => isPassengerService(service) && Array.isArray(rec(service).stops) && (rec(service).stops.length > 1)))
            return 0;
        if (slot.name === 'Portail Wi-Fi' && !this.features.some(feature => feature.active && feature.name === 'Wi-Fi à bord'))
            return 0;
        if (slot.name === 'Sets de plateau restauration' && !this.catering.some(item => item.active))
            return 0;
        if (slot.name === 'Salon Premium' && !this.features.some(feature => feature.active && feature.name === 'Salon en gare'))
            return 0;
        const perPassenger = slot.placement === 'À bord' ? .015 : slot.placement === 'Gare' ? .012 : .008;
        return Math.floor(Math.max(0, passengers) * perPassenger * 100) / 100;
    }
    _syncAdQuotes(game) {
        this._simpleAdvertising = !['expert', 'ultra'].includes(s(rec(game.realismSettings).difficulty, 'easy'));
        const pending = Math.max(0, n(game.economy.totalPassengers) - this._lastPassengerCount);
        const audience = pending > 0 ? pending : this.stats.dailyPassengers;
        this._adQuotes = {};
        for (const slot of this.adSlots)
            this._adQuotes[slot.id] = this._advertisingQuote(game, slot, audience);
    }
    _saveAdTerms(container, game, slot, sign) {
        this._syncAdQuotes(game);
        const value = (field) => [...container.querySelectorAll('[data-ad-field]')].find(node => node.getAttribute('data-id') === slot.id && node.getAttribute('data-ad-field') === field)?.value;
        const advertiser = s(value('advertiser'), slot.advertiser).trim() || (sign ? 'Annonceur partenaire' : '');
        const dailyPrice = clamp(n(value('dailyPrice'), slot.dailyPrice), 0, 1e7);
        const contractDays = clamp(Math.round(n(value('contractDays'), slot.contractDays)), 1, 365);
        if (!this._simpleAdvertising && (sign || slot.active)) {
            const quote = this._adQuotes[slot.id] || 0;
            if (quote <= 0 || dailyPrice > quote) {
                this._adMessage = quote <= 0 ? 'Contrat refusé : aucune audience voyageurs avec les équipements ou dessertes nécessaires.' : 'Contrat refusé : le prix dépasse le plafond de la régie pour l’audience réelle (' + fmt(quote, 2) + ' €/jour).';
                return false;
            }
        }
        Object.assign(slot, { advertiser, dailyPrice, contractDays });
        if (sign) {
            slot.active = true;
            slot.daysRemaining = contractDays;
        }
        else if (!slot.active)
            slot.daysRemaining = contractDays;
        container.querySelectorAll('[data-ad-field]').forEach(node => { if (node.getAttribute('data-id') === slot.id) {
            const field = node.getAttribute('data-ad-field');
            if (field === 'advertiser')
                node.value = advertiser;
            else if (field === 'dailyPrice')
                node.value = String(dailyPrice);
            else if (field === 'contractDays')
                node.value = String(contractDays);
        } });
        this._adMessage = sign ? 'Contrat signé aux conditions affichées.' : 'Conditions publicitaires enregistrées.';
        return true;
    }
    _collectGalleryTrains(game) {
        const services = (game.scheduleCreator?.getActiveServices?.() || []);
        return services.filter(isPassengerService).slice(0, 3).map(value => {
            const svc = rec(value), train = rec(svc.train), rame = rec(svc.rame);
            const details = Array.isArray(rame.elementDetails) ? rame.elementDetails : [];
            const image = details.map(detail => s(rec(detail).imageData)).find(src => /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src));
            const capacity = Math.max(0, n(rame.totalCapacity));
            return { name: s(svc.name || train.name, 'Service voyageurs'), rameName: s(rame.name, 'Rame voyageurs'), delay: n(train.delay), occupancy: capacity ? clamp(n(svc._onboardPax) / capacity * 100, 0, 100) : 0, imageSrc: image || 'img/livemap/train_voyageur.png', isOwnImage: !!image };
        });
    }
    _collectGameStats(game) {
        const eco = game.economy;
        const all = Array.isArray(game.scheduleCreator.services)
            ? game.scheduleCreator.services : [];
        const active = typeof game.scheduleCreator?.getActiveServices === 'function' ? game.scheduleCreator.getActiveServices() : [];
        const paxAll = all.filter(isPassengerService), live = active.filter(isPassengerService);
        const moving = live.filter(v => s(rec(v).state) === 'moving');
        let onTime = 0, totalDelay = 0;
        for (const v of moving) {
            const delay = n(rec(rec(v).train).delay);
            totalDelay += delay;
            if (Math.abs(delay) <= 5)
                onTime++;
        }
        const punctuality = moving.length ? onTime / moving.length * 100 : (this.history.at(-1)?.punctuality ?? 100);
        const cancelled = paxAll.filter(v => b(rec(v).cancelled) || s(rec(v).state) === 'cancelled').length;
        const freightAll = all.filter(isFreightService), freightLive = active.filter(isFreightService);
        const freightMoving = freightLive.filter(v => s(rec(v).state) === 'moving');
        let freightOnTime = 0, freightDelay = 0, freightOnboard = 0, freightCapacity = 0;
        for (const v of freightMoving) {
            const delay = n(rec(rec(v).train).delay);
            freightDelay += delay;
            if (Math.abs(delay) <= 5)
                freightOnTime++;
        }
        for (const v of freightLive) {
            const service = rec(v), rame = rec(service.rame);
            freightOnboard += Math.max(0, n(service._onboardFreight)) + Math.max(0, n(service._contractFreight));
            freightCapacity += Math.max(0, n(rame.totalFreightCapacity));
        }
        const freightCancelled = freightAll.filter(v => b(rec(v).cancelled) || s(rec(v).state) === 'cancelled').length;
        const rames = (game.rameManager?.getAll?.() || []);
        const passengerRames = rames.filter(v => n(rec(v).totalCapacity) > 0);
        let clean = 0;
        for (const r of passengerRames) {
            const c = rec(rec(r).cleanliness);
            clean += (n(c.interior, 100) * .72 + n(c.exterior, 100) * .28);
        }
        const cleanliness = this._observedScore('cleanliness', passengerRames.length ? clean / passengerRames.length : 100, value => Number(value));
        let onboard = 0, cap = 0;
        for (const v of live) {
            onboard += Math.max(0, n(rec(v)._onboardPax));
            cap += Math.max(0, n(rec(rec(v).rame).totalCapacity));
        }
        const actualSat = eco.passengerSatisfaction == null ? 70 : clamp(n(eco.passengerSatisfaction, 70), 0, 100);
        return { totalPassengers: Math.max(0, n(eco.totalPassengers)), dailyPassengers: this.stats.dailyPassengers,
            totalTicketRevenue: Math.max(0, n(eco.totalTicketRevenue)), totalFreightTonnes: Math.max(0, n(eco.totalFreightTonnes)),
            totalFreightRevenue: Math.max(0, n(rec(eco.revenueByCategory).fret)), freightServices: freightAll.length,
            liveFreightServices: freightLive.length, freightPunctuality: freightMoving.length ? freightOnTime / freightMoving.length * 100 : 100,
            freightAvgDelay: freightMoving.length ? freightDelay / freightMoving.length : 0, freightCancelled,
            freightLoad: freightCapacity ? clamp(freightOnboard / freightCapacity * 100, 0, 100) : 0,
            passengerSatisfaction: actualSat, punctuality: clamp(punctuality, 0, 100), avgDelay: moving.length ? totalDelay / moving.length : 0,
            cancelled, passengerServices: paxAll.length, livePassengerServices: live.length, cleanliness: clamp(cleanliness, 0, 100),
            occupancy: cap ? clamp(onboard / cap * 100, 0, 100) : 0, cumulativeRevenue: Math.max(0, n(eco.revenue)), cumulativeExpenses: Math.max(0, n(eco.expenses)) };
    }
    _deliveredPunctuality(g) {
        const punctuality = this._arrivalObservation?.punctuality ?? this._lastDeliveredPunctuality ?? g.punctuality;
        const avgDelay = this._arrivalObservation?.avgDelay ?? this._lastDeliveredAvgDelay ?? g.avgDelay;
        return clamp(punctuality - Math.max(0, avgDelay - 5) * .8, 0, 100);
    }
    _observedScore(field, fallback, convert) {
        const rows = (this._arrivalObservation?.arrivals || []).filter(row => !row.cancelled && row[field] != null);
        const weight = rows.reduce((sum, row) => sum + Number(row.passengers), 0);
        return weight > 0 ? clamp(rows.reduce((sum, row) => sum + convert(row[field], row) * Number(row.passengers), 0) / weight, 0, 100) : this._lastDeliveredQuality?.scores[field] ?? fallback;
    }
    _computeDimensions(g) { const activeFeatures = this.features.filter(x => x.active); const featureSat = activeFeatures.reduce((z, x) => z + x.satisfactionBoost, 0); const featureIds = new Set(activeFeatures.map(x => x.id)); const menu = this.catering.filter(x => x.active); const menuQuality = menu.length ? menu.reduce((z, x) => z + x.quality, 0) / menu.length : 45; const variety = clamp(menu.length * 3, 0, 30); const offerSat = this.offers.filter(x => x.active).reduce((z, x) => z + x.satisfactionBoost, 0); const punctuality = this._deliveredPunctuality(g); const cleanliness = clamp(g.cleanliness, 0, 100); const comfort = this._observedScore('comfortFactor', clamp(58 + featureSat * .7 + cleanliness * .22, 0, 100), (value, row) => 85 * Number(value) - Math.max(0, Number(row.occupancy || 0) - .85) * 30); const catering = this._observedScore('restaurantFactor', clamp(menuQuality * .72 + variety + (menu.some(x => x.local) ? 4 : 0) + (menu.some(x => x.vegetarian) ? 3 : 0), 0, 100), value => 100 * Number(value)); const value = this._observedScore('fareRatio', clamp((this.settings.farePolicy === 'éco' ? 88 : this.settings.farePolicy === 'équilibrée' ? 76 : 63) + offerSat * .45, 0, 100), value => 100 - Math.max(0, Number(value) - 1) * 40); const information = this._observedScore('informationAvailable', clamp(68 + (activeFeatures.some(x => x.name.includes('Info temps réel')) ? 16 : 0) + (this.settings.customerCare === 'excellence' ? 7 : this.settings.customerCare === 'renforcé' ? 3 : 0), 0, 100), value => value === false ? 0 : 100); const customerCare = clamp(52 + this.stats.replyRate * .35 + (this.settings.compensationPolicy === 'généreuse' ? 18 : this.settings.compensationPolicy === 'équilibrée' ? 10 : 3) + (this.settings.customerCare === 'excellence' ? 14 : this.settings.customerCare === 'renforcé' ? 8 : 2), 0, 100); const digital = clamp(55 + (activeFeatures.some(x => x.name.includes('Wi-Fi')) ? 18 : 0) + (activeFeatures.some(x => x.name.includes('Streaming')) ? 9 : 0) + (activeFeatures.some(x => x.name.includes('Presse numérique')) ? 6 : 0), 0, 100); const brand = clamp(this.stats.awareness * .75 + this.stats.loyalty * .25 + (this.settings.greenCommunication ? 5 : 0), 0, 100); const campaignSat = Math.max(this._lastCampaignSatisfaction, clamp(this.campaigns.filter(c => c.active && c.target !== 'Fret').reduce((sum, c) => sum + c.satisfactionGain, 0), 0, 30)); const global = clamp(campaignSat + g.passengerSatisfaction * .38 + punctuality * .16 + comfort * .10 + cleanliness * .08 + catering * .07 + value * .06 + information * .05 + customerCare * .04 + digital * .03 + brand * .03, 0, 100); void featureIds; return { global: Math.round(global), punctuality: Math.round(punctuality), comfort: Math.round(comfort), cleanliness: Math.round(cleanliness), catering: Math.round(catering), value: Math.round(value), information: Math.round(information), customerCare: Math.round(customerCare), digital: Math.round(digital), brand: Math.round(brand) }; }
    _isFreightSummary(f) { return f.serviceCategory === 'fret' && f.category === 'Bilan de livraison'; }
    _recomputeDerived() { const customerFeedbacks = this.feedbacks.filter(x => !this._isFreightSummary(x)); const ratings = customerFeedbacks.map(x => x.rating); this.stats.averageFeedback = ratings.length ? ratings.reduce((z, x) => z + x, 0) / ratings.length : 4; this.stats.replyRate = customerFeedbacks.length ? customerFeedbacks.filter(x => x.responded && x.responseText.trim().length > 0).length / customerFeedbacks.length * 100 : 0; this.stats.pressScore = this.pressReviews.length ? clamp(Math.round(this.pressReviews.slice(0, 12).reduce((z, x) => z + x.score, 0) / Math.min(12, this.pressReviews.length)), 0, 100) : 70; this.stats.activeCampaigns = this.campaigns.filter(x => x.active).length; this.stats.activeOffers = this.offers.filter(x => x.active).length; this.stats.activeMenuItems = this.catering.filter(x => x.active).length; this.stats.activeFeatures = this.features.filter(x => x.active).length; const offerDemand = this.offers.filter(x => x.active).reduce((z, x) => z + x.demandBoost, 0); const featDemand = this.features.filter(x => x.active).reduce((z, x) => z + x.demandBoost, 0); const campDemand = this.campaigns.filter(x => x.active && x.target !== 'Fret').reduce((z, x) => z + x.demandGain, 0); this.stats.demandMultiplier = clamp(1 + (this.stats.awareness - 50) / 600 + (this.stats.loyalty - 50) / 900 + (offerDemand + featDemand + campDemand) / 700, .72, 1.55); const base = this.settings.farePolicy === 'éco' ? .90 : this.settings.farePolicy === 'premium' ? 1.12 : 1; const offerPrice = this.offers.filter(x => x.active).reduce((z, x) => z + x.priceDeltaPct, 0); this.stats.fareMultiplier = clamp(base * (1 + offerPrice / Math.max(1, this.offers.filter(x => x.active).length) / 100 * .35), .72, 1.28); }
    _dayHash(day, salt) { let h = 2166136261; for (const ch of `${day}|${salt}`) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 16777619);
    } return ((h >>> 0) % 100000) / 100000; }
    _pick(arr, day, salt) { return arr[Math.floor(this._dayHash(day, salt) * arr.length) % arr.length]; }
    _canGenerateFeedback(day, game) {
        const total = Math.max(0, n(game.economy.totalPassengers));
        return !!day && day !== this._lastDailyDate && (total > this._lastPassengerCount || this._arrivalObservation?.arrivals.some(row => row.cancelled)) && !this.feedbacks.some(review => review.date === day && review.serviceCategory !== 'fret' && review.origin !== 'solicited');
    }
    _generateFeedback(day, game, count = 1) {
        if (!this._canGenerateFeedback(day, game))
            return;
        this.syncFromGame(game);
        const ordered = Object.entries(this._dimensions)
            .filter(([key]) => key !== 'global').sort((a, b) => a[1] - b[1]);
        const priorities = [ordered[0], ordered.at(-1), ordered[Math.floor(ordered.length / 2)]];
        const offset = Math.floor(this._dayHash(day, 'review-topic') * 3);
        const baseTopics = count >= 3 ? [...priorities, ...ordered.filter(([key]) => !priorities.some(([priority]) => priority === key))] :
            [priorities[offset], priorities[(offset + 1) % 3]];
        const arrivals = (this._arrivalObservation?.arrivals || []).filter(row => row.cancelled || this._hasJourneyEvidence(row));
        const sampledArrival = arrivals.find(row => row.cancelled || (row.missedConnections || 0) > 0 || (row.deniedBoarding || 0) > 0) || arrivals.filter(row => row.delayMinutes > 5)
            .sort((a, b) => b.delayMinutes - a.delayMinutes)[0] || arrivals[0];
        const topics = sampledArrival ? [['punctuality', this._dimensions.punctuality],
            ...baseTopics.filter(([key]) => key !== 'punctuality')] : baseTopics;
        const newPassengers = Math.max(this._arrivalObservation?.passengers || 0, this._liveSnapshot.totalPassengers - this._lastPassengerCount);
        const reviewCount = Math.min(6, Math.max(1, Math.round(count)), newPassengers, topics.length);
        for (let i = 0; i < reviewCount; i++) {
            if (sampledArrival) {
                const row = i === 0 ? sampledArrival : arrivals[i % arrivals.length];
                this.feedbacks.unshift(this._passengerExperienceFeedback(day, row, i, 'traffic'));
                continue;
            }
            const [key, score] = topics[i], category = this._dimensionLabel(key);
            const wobble = this._dayHash(day, `review-rating-${i}`) < .15 ? -1 : this._dayHash(day, `review-rating-plus-${i}`) > .9 ? 1 : 0;
            const rating = clamp(Math.round(score / 20) + wobble, 1, 5);
            const tone = rating >= 4 ? 'positive' : rating === 3 ? 'mixed' : 'negative';
            // Old saves may retain traffic totals without any journey details.
            // Current commercial dimensions can inform a survey, never an onboard experience.
            this.feedbacks.unshift({ id: randId('fb'), date: day, author: 'Voyageur potentiel', rating, category,
                title: `${category} : attentes sur l’offre`, message: this._offerSurveyText(category, day, i), sentiment: tone,
                status: 'new', responded: false, responseText: '', serviceName: '', serviceCategory: 'voyageur', origin: 'traffic', experience: 'survey' });
        }
        this.feedbacks = this.feedbacks.slice(0, 160);
        this._recomputeDerived();
    }
    _hasJourneyEvidence(row) { return !row.cancelled && !!row.serviceName.trim() && !!row.stationName.trim(); }
    _offerSurveyText(category, day, index) {
        const prompts = {
            'Ponctualité': ['Avant de réserver, je regarde la régularité de l’offre.', 'Je souhaite connaître les engagements horaires avant de réserver.'],
            'Propreté': ['Avant de réserver, je souhaite connaître les engagements de propreté.', 'J’aimerais plus d’informations sur le nettoyage proposé.'],
            'Confort': ['Je compare le confort proposé avant de réserver.', 'J’aimerais connaître les équipements de confort annoncés.'],
            'Rapport qualité-prix': ['Je compare les tarifs et le service annoncé.', 'Avant de réserver, je regarde ce qui est inclus dans le prix.'],
            'Restauration': ['Je consulte l’offre de restauration avant de réserver.', 'J’aimerais connaître le menu proposé pour ce service.'],
            'Information': ['Je souhaite trouver des informations claires avant de réserver.', 'J’attends des renseignements précis sur l’offre annoncée.']
        };
        const choices = prompts[category] || [`Avant de réserver, je regarde l’offre concernant ${category.toLowerCase()}.`, `J’aimerais davantage d’informations sur ${category.toLowerCase()} avant de réserver.`];
        return this._pick(choices, day, `offer-survey-${index}`);
    }
    _passengerExperienceFeedback(day, row, index, origin) {
        const incident = row.cancelled || (row.missedConnections || 0) > 0 || (row.deniedBoarding || 0) > 0;
        const punctualityRating = row.cancelled ? 1 : incident ? 2 : row.delayMinutes > 5 ? clamp(Math.round(4 - row.delayMinutes / 15), 1, 3) : row.delayMinutes < -5 ? 3 : 5;
        const quality = [];
        if (row.comfortFactor != null)
            quality.push(['comfort', clamp(85 * row.comfortFactor - Math.max(0, (row.occupancy || 0) - .85) * 30, 0, 100)]);
        if (row.cleanliness != null)
            quality.push(['cleanliness', row.cleanliness]);
        if (row.restaurantFactor != null)
            quality.push(['catering', 100 * row.restaurantFactor]);
        if (row.fareRatio != null)
            quality.push(['value', clamp(100 - Math.max(0, row.fareRatio - 1) * 40, 0, 100)]);
        if (row.informationAvailable != null)
            quality.push(['information', row.informationAvailable ? 100 : 0]);
        quality.sort((a, b) => a[1] - b[1]);
        const [topic, score] = incident || index === 0 || !quality.length
            ? ['punctuality', punctualityRating * 20] : quality[(index - 1) % quality.length];
        const category = this._dimensionLabel(topic), rating = clamp(Math.round(score / 20), 1, 5);
        const service = { ...row, name: row.serviceName || 'Service voyageurs', delay: row.delayMinutes, arrived: !row.cancelled };
        return { id: randId('fb'), date: day, author: this._pick(FEEDBACK_NAMES, day, `experience-name-${index}`), rating, category,
            title: this._reviewTitle(category, rating), message: this._reviewText(category, rating, service, day, index),
            sentiment: rating >= 4 ? 'positive' : rating === 3 ? 'mixed' : 'negative', status: 'new', responded: false, responseText: '',
            serviceName: service.name, serviceCategory: 'voyageur', origin, experience: row.cancelled ? 'disruption' : 'journey' };
    }
    _canGenerateFreightFeedback(day, game) {
        const delivered = Math.max(0, n(game.economy.totalFreightTonnes));
        return !!day && !this._freightBaselinePending && delivered > this._lastFreightFeedbackCount
            && !this.feedbacks.some(review => review.date === day && review.serviceCategory === 'fret' && review.origin !== 'solicited');
    }
    _generateFreightFeedback(day, game) {
        if (!this._canGenerateFreightFeedback(day, game))
            return;
        this.syncFromGame(game);
        const tonnes = Math.max(0, this._liveSnapshot.totalFreightTonnes - this._lastFreightFeedbackCount);
        this.feedbacks.unshift({ id: randId('fb'), date: day, author: 'Indicateur fret', rating: 3,
            category: 'Bilan de livraison', title: `Bilan fret : ${fmt(tonnes)} t livrées`,
            message: `${fmt(tonnes)} t de marchandises ont été effectivement livrées depuis le dernier bilan.`,
            sentiment: 'mixed', status: 'closed', responded: false, responseText: '', serviceName: '', serviceCategory: 'fret', origin: 'traffic' });
        this.feedbacks = this.feedbacks.slice(0, 160);
        this._lastFreightFeedbackCount = this._liveSnapshot.totalFreightTonnes;
        this._lastFreightFeedbackRevenue = this._liveSnapshot.totalFreightRevenue;
        this._recomputeDerived();
    }
    _reviewService(game, category, index, rating) {
        if (category !== 'Ponctualité' || rating === 3)
            return null;
        const services = (game.scheduleCreator?.getActiveServices?.() || []);
        const matching = services.filter(value => isPassengerService(value) && s(rec(value).state) === 'moving')
            .filter(value => rating >= 4 ? Math.abs(n(rec(rec(value).train).delay)) <= 5 : Math.abs(n(rec(rec(value).train).delay)) > 5);
        if (!matching.length)
            return null;
        const raw = rec(matching[index % matching.length]);
        return { name: s(raw.name || rec(raw.train).name, 'Service voyageurs'), delay: n(rec(raw.train).delay) };
    }
    _reviewTitle(cat, rating) { if (rating === 5)
        return `${cat} : avis très positif`; if (rating === 4)
        return `${cat} : avis positif`; if (rating === 3)
        return `${cat} : avis mitigé`; if (rating === 2)
        return `${cat} : avis négatif`; return `${cat} : avis très négatif`; }
    _reviewText(cat, rating, svc, day = '', index = 0) {
        const tone = rating >= 4 ? 0 : rating === 3 ? 1 : 2;
        const activeFood = this.catering.some(item => item.active);
        const activeFeatures = this.features.filter(item => item.active);
        const comments = {
            'Ponctualité': ['Mon trajet m’a paru régulier.', 'La régularité des trajets me semble variable.', 'J’aimerais pouvoir mieux compter sur les horaires annoncés.'],
            'Propreté': ['La propreté à bord m’a fait bonne impression.', 'La propreté à bord me semble correcte, avec quelques détails à améliorer.', 'La propreté à bord m’a déçu.'],
            'Rapport qualité-prix': ['Le prix de mon billet m’a semblé cohérent avec le service proposé.', 'J’aimerais mieux comprendre ce qui est inclus dans mon billet.', 'Le prix de mon billet m’a paru élevé pour le service proposé.'],
            'Service client': ['Les conditions d’échange et de prise en charge me semblent claires.', 'Je voudrais trouver plus facilement les conditions de prise en charge.', 'Les démarches prévues en cas d’imprévu me semblent peu claires.'],
            'Image de marque': ['La communication de la compagnie me paraît claire.', 'Je commence à reconnaître la compagnie, mais je cherche encore ses différences.', 'J’ai du mal à comprendre ce que la compagnie propose.'],
            'Confort': ['Je me suis senti à l’aise à bord.', 'Le confort à bord me semble correct, sans plus.', 'J’aurais aimé voyager dans de meilleures conditions.']
        };
        let observation = comments[cat]?.[tone] || 'Mon expérience de voyage me laisse une impression à partager.';
        if (svc?.cancelled)
            observation = `Mon train ${svc.name} a été supprimé. ${svc.reason || ''}`;
        else if ((svc?.missedConnections || 0) > 0)
            observation = `Sur ${svc.name}, une correspondance a été manquée à ${svc.stationName}.`;
        else if ((svc?.deniedBoarding || 0) > 0)
            observation = `Sur ${svc.name}, des voyageurs n’ont pas pu monter faute de place.`;
        else if (cat === 'Ponctualité' && svc) {
            const minutes = Math.abs(Math.round(svc.delay));
            observation = svc.arrived
                ? !minutes ? `Sur ${svc.name}, je suis arrivé à l’heure à ${svc.stationName}.`
                    : svc.delay < 0 ? `Sur ${svc.name}, je suis arrivé avec ${minutes} min d’avance à ${svc.stationName}.`
                        : `Sur ${svc.name}, je suis arrivé avec ${minutes} min de retard à ${svc.stationName}.`
                : !minutes
                    ? `Sur ${svc.name}, je vois un horaire respecté à cet instant.`
                    : svc.delay < 0
                        ? `Sur ${svc.name}, je vois ${minutes} min d’avance à cet instant.`
                        : `Sur ${svc.name}, je vois ${minutes} min de retard à cet instant.`;
        }
        else if (cat === 'Restauration')
            observation = svc?.arrived && svc.restaurantFactor != null
                ? ['La restauration à bord m’a plu pendant ce voyage.', 'La restauration à bord m’a laissé une impression mitigée.', 'La restauration à bord ne m’a pas satisfait pendant ce voyage.'][tone]
                : activeFood
                    ? ['La carte proposée à bord m’a plu.', 'J’aimerais davantage de choix dans la carte proposée à bord.', 'La carte proposée à bord ne m’a pas convaincu.'][tone]
                    : 'Je n’ai pas trouvé de restauration proposée à bord.';
        else if (cat === 'Digital')
            observation = activeFeatures.some(f => f.name.includes('Wi-Fi'))
                ? ['La présence annoncée du Wi-Fi à bord est appréciable.', 'J’aimerais en savoir plus sur l’accès Wi-Fi à bord.', 'L’accès Wi-Fi annoncé ne répond pas à mes attentes.'][tone]
                : 'Je n’ai pas vu de Wi-Fi annoncé parmi les services à bord.';
        else if (cat === 'Information')
            observation = svc?.arrived && svc.informationAvailable != null
                ? svc.informationAvailable ? 'Les informations de trajet étaient disponibles pendant mon voyage.' : 'Les informations de trajet n’étaient pas disponibles pendant mon voyage.'
                : activeFeatures.some(f => f.name.includes('Info temps réel'))
                    ? ['Les informations de trajet annoncées me sont utiles.', 'Je voudrais des informations de trajet plus faciles à suivre.', 'Les informations de trajet me paraissent insuffisantes.'][tone]
                    : 'Je voudrais être mieux informé avant et pendant mon trajet.';
        if (svc?.arrived && !svc.cancelled && cat !== 'Ponctualité' && (svc.missedConnections || 0) === 0 && (svc.deniedBoarding || 0) === 0)
            observation = `Sur ${svc.name}, pendant mon trajet jusqu’à ${svc.stationName || 'destination'}, ${observation.charAt(0).toLowerCase()}${observation.slice(1)}`;
        const endings = rating >= 4
            ? ['Une qualité que je souhaite retrouver sur mes prochains trajets.', 'Cela rend le voyage plus agréable.', 'Le résultat est encourageant pour les voyageurs.']
            : rating === 3
                ? ['Il reste une marge d’amélioration.', 'J’aimerais davantage de constance.', 'L’ensemble peut encore progresser.']
                : ['Une amélioration serait bienvenue.', 'Ce point devrait devenir prioritaire.', 'Cela pèse sur l’expérience du voyage.'];
        return `${observation} ${endings[Math.floor(this._dayHash(day, `review-copy-${cat}-${index}`) * endings.length)]}`;
    }
    _dimensionLabel(k) { return { punctuality: 'Ponctualité', comfort: 'Confort', cleanliness: 'Propreté', catering: 'Restauration', value: 'Rapport qualité-prix', information: 'Information', customerCare: 'Service client', digital: 'Digital', brand: 'Image de marque', global: 'Satisfaction' }[k] || String(k); }
    _generatePress(day, game, forced = false) { this.syncFromGame(game); const g = this._liveSnapshot; if (g.totalPassengers <= 0 || this.pressReviews.some(review => review.date === day && review.serviceCategory !== 'fret' && review.origin !== 'solicited'))
        return; const score = clamp(Math.round(this.stats.satisfaction * .55 + g.punctuality * .25 + this.stats.awareness * .12 + this.stats.loyalty * .08 + (forced ? 4 : 0)), 25, 98); const tone = score >= 78 ? 'positive' : score >= 58 ? 'mixed' : 'negative'; const media = this._pick(PRESS_MEDIA, day, `press${this.pressReviews.length}`); const title = score >= 84 ? 'Une expérience voyageur qui devient une référence' : score >= 72 ? 'Rail Empire consolide son offre client' : score >= 58 ? 'Une stratégie commerciale ambitieuse, encore inégale' : 'L’expérience client reste le talon d’Achille'; const excerpt = score >= 78 ? `Avec ${fmt(g.totalPassengers)} voyageurs transportés et une ponctualité instantanée de ${pct(g.punctuality)}, la compagnie combine désormais offre à bord, fidélité et communication de manière cohérente.` : score >= 58 ? `La compagnie affiche ${fmt(g.totalPassengers)} voyageurs cumulés et une satisfaction de ${this.stats.satisfaction}/100. Certains irritants d’exploitation restent visibles.` : `Les investissements marketing sont visibles, mais un score de satisfaction de ${this.stats.satisfaction}/100 et une ponctualité de ${pct(g.punctuality)} montrent que la promesse client doit encore être mieux tenue.`; this.pressReviews.unshift({ id: randId('press'), date: day, media, title, excerpt, score, tone, serviceCategory: 'voyageur' }); this.pressReviews = this.pressReviews.slice(0, 60); this._recomputeDerived(); }
    _generateFreightPress(day, game, forced = false, deliveredToday = 0, revenueToday = 0) {
        this.syncFromGame(game);
        const g = this._liveSnapshot;
        if (g.totalFreightTonnes <= 0 || this.pressReviews.some(review => review.date === day && review.serviceCategory === 'fret' && review.origin !== 'solicited'))
            return;
        const daily = deliveredToday > 0;
        const tonnes = daily ? deliveredToday : g.totalFreightTonnes;
        const revenue = daily ? revenueToday : g.totalFreightRevenue;
        const activeFreight = (game.scheduleCreator?.getActiveServices?.() || []).some((value) => isFreightService(value) && s(rec(value).state) === 'moving');
        const score = clamp(Math.round(70 + (this.stats.awareness - 50) * .12
            + (activeFreight ? (g.freightPunctuality - 75) * .16 : 0) - Math.min(15, g.freightCancelled * 2) + (forced ? 4 : 0)), 25, 98);
        const tone = score >= 78 ? 'positive' : score >= 58 ? 'mixed' : 'negative';
        const media = this._pick(PRESS_MEDIA, day, `press-fret-${this.pressReviews.length}`);
        const title = `Fret : ${fmt(tonnes)} t livrées par Rail Empire`;
        const period = daily ? 'sur cette journée' : 'depuis le début de la partie';
        const excerpt = `La compagnie a effectivement livré ${fmt(tonnes)} t de marchandises ${period}, pour ${euro(revenue)} de recettes fret.${activeFreight ? ` Ses trains fret actuellement en marche affichent une ponctualité de ${pct(g.freightPunctuality)}.` : ''}`;
        this.pressReviews.unshift({ id: randId('press'), date: day, media, title, excerpt, score, tone, serviceCategory: 'fret' });
        this.pressReviews = this.pressReviews.slice(0, 60);
        this._recomputeDerived();
    }
    _tone(v) { return v >= 80 ? 'good' : v >= 60 ? 'mid' : 'bad'; }
    _renderPage() { const tab = this._tab; return `<div class="marketing-shell"><section class="marketing-hero"><div class="marketing-eyebrow">${icon('marketing', 18)} RAIL EMPIRE · EXPÉRIENCE CLIENT & MARKETING</div><div class="marketing-title"><div><h2>Marketing voyageurs & fret</h2><p>Pilote les offres et campagnes commerciales voyageurs et fret, les services à bord, la restauration, la publicité, la satisfaction, les retours clients et l’image presse. Les indicateurs ci-dessous sont recalculés à partir de ta partie.</p></div><div class="marketing-live">${icon('signal', 14)} ${fmt(this._liveSnapshot.totalPassengers)} voyageurs cumulés · ${this._liveSnapshot.livePassengerServices} train(s) voyageurs actif(s) · ${fmt(this._liveSnapshot.totalFreightTonnes)} t livrées · ${this._liveSnapshot.liveFreightServices} train(s) fret actif(s)</div></div><div class="marketing-grid-kpi">${this._kpi('Satisfaction', `${this.stats.satisfaction}/100`, `Base réelle RE : ${Math.round(this._liveSnapshot.passengerSatisfaction)}/100`, 'heart')}${this._kpi('Ponctualité', pct(this._liveSnapshot.punctuality), `Trains en marche · retard moyen ${fmt(this._liveSnapshot.avgDelay, 1)} min`, 'clock')}${this._kpi('Notoriété', `${this.stats.awareness}/100`, `${this.stats.activeCampaigns} campagne(s) active(s)`, 'megaphone')}${this._kpi('Fidélité', `${this.stats.loyalty}/100`, `Demande ×${this.stats.demandMultiplier.toFixed(2)}`, 'gift')}${this._kpi('Recettes annexes', euro(this.stats.onboardRevenueToday + this.stats.adRevenueToday), `Restauration + publicité · dernier jour`, 'money')}${this._kpi('Presse', `${this.stats.pressScore}/100`, `${this.pressReviews.length} article(s) conservé(s)`, 'newspaper')}</div></section>${this._renderTabs(tab)}${this._renderTab(tab)}</div>`; }
    _renderTabs(tab) { const items = [['overview', 'Vue générale', 'dashboard'], ['freight', 'Fret', 'cargo'], ['onboard', 'À bord & restauration', 'restaurant'], ['offers', 'Offres clients', 'ticket'], ['campaigns', 'Campagnes', 'megaphone'], ['ads', 'Publicité', 'ads'], ['satisfaction', 'Satisfaction', 'heart'], ['feedback', 'Avis clients', 'message'], ['press', 'Presse', 'newspaper']]; return `<nav class="marketing-tabs">${items.map(([id, label, ic]) => `<button class="${tab === id ? 'active' : ''}" data-mk-tab="${id}">${icon(ic, 15)} ${esc(label)}</button>`).join('')}</nav>`; }
    _renderTab(tab) { if (tab === 'freight')
        return this._renderFreight(); if (tab === 'onboard')
        return this._renderOnboard(); if (tab === 'offers')
        return this._renderCommercialOffers() + this._renderOffers(); if (tab === 'campaigns')
        return this._renderCampaigns(); if (tab === 'ads')
        return this._renderAds(); if (tab === 'satisfaction')
        return this._renderSatisfaction(); if (tab === 'feedback')
        return this._renderFeedback(); if (tab === 'press')
        return this._renderPress(); return this._renderOverview(); }
    _renderFreight() {
        const g = this._liveSnapshot, offers = this.serviceOffers.filter(o => o.category === 'fret');
        const campaigns = this.campaigns.filter(c => c.target === 'Fret' && c.active);
        return `<div class="marketing-sections"><section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('cargo', 18)} Activité commerciale fret</h3><p class="marketing-sub">Chiffres réels issus des livraisons, des recettes fret et des trains de ta partie. Le chargement ne compte que les rames fret en circulation.</p></div></div><div class="mk-stat-grid">${this._stat('Marchandises livrées', `${fmt(g.totalFreightTonnes)} t`, 'cargo')}${this._stat('Recettes fret', euro(g.totalFreightRevenue), 'money')}${this._stat('Services fret', fmt(g.freightServices), 'train')}${this._stat('Trains fret actifs', fmt(g.liveFreightServices), 'train')}${this._stat('Ponctualité fret', pct(g.freightPunctuality), 'clock')}${this._stat('Chargement live', pct(g.freightLoad), 'cargo')}${this._stat('Retard moyen fret', `${fmt(g.freightAvgDelay, 1)} min`, 'clock')}${this._stat('Annulations fret', fmt(g.freightCancelled), 'warning')}${this._stat('Avis fret', fmt(this.feedbacks.filter(f => f.serviceCategory === 'fret' && !this._isFreightSummary(f)).length), 'message')}${this._stat('Bilans fret', fmt(this.feedbacks.filter(f => this._isFreightSummary(f)).length), 'cargo')}${this._stat('Articles fret', fmt(this.pressReviews.filter(p => p.serviceCategory === 'fret').length), 'newspaper')}</div><p class="marketing-sub">Les avis et articles fret figurent dans les onglets « Avis clients » et « Presse », avec un repère Fret.</p></section><section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('ticket', 18)} Offres commerciales fret</h3><p class="marketing-sub">Les offres modifient la demande et le tarif d'un horaire compatible. L'affectation se fait dans le Schedule Creator ; le prix de base vient toujours de Marchandises.</p></div><span class="mk-badge">${offers.filter(o => o.active).length} active(s)</span></div><div class="mk-stat-grid">${this._stat('Offres créées', fmt(offers.length), 'ticket')}${this._stat('Campagnes fret actives', fmt(campaigns.length), 'megaphone')}${this._stat('Demande fret', `×${this.getFreightDemandMultiplier().toFixed(2)}`, 'cargo')}</div><p class="marketing-sub">Crée tes offres dans « Offres clients » et cible « Fret » dans « Campagnes ». Une campagne fret agit sur le volume demandé par les chargeurs pendant sa durée ; elle ne crée aucun chargement dans une gare non compatible.</p></section></div>`;
    }
    _renderOverview() { const g = this._liveSnapshot, d = this._dimensions; const alerts = []; if (g.punctuality < 70)
        alerts.push(['bad', 'Ponctualité dégradée', `Seulement ${pct(g.punctuality)} des trains voyageurs en mouvement sont à ±5 min.`]); if (g.cleanliness < 70)
        alerts.push(['bad', 'Propreté insuffisante', `Indice moyen des rames voyageurs : ${Math.round(g.cleanliness)}/100.`]); if (this.stats.replyRate < 60 && this.feedbacks.some(f => !this._isFreightSummary(f)))
        alerts.push(['mid', 'Retours clients en attente', `${Math.round(100 - this.stats.replyRate)} % des avis ne sont pas encore traités.`]); if (this.catering.filter(x => x.active).length < 6)
        alerts.push(['mid', 'Carte à bord courte', 'Active davantage de références pour améliorer le choix et le panier moyen.']); if (!alerts.length)
        alerts.push(['good', 'Expérience client maîtrisée', 'Aucun signal critique détecté dans les indicateurs actuels.']); return `<div class="marketing-sections">${this._renderPhotography()}<section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('chart', 18)} Indicateurs réels de la partie</h3><p class="marketing-sub">Ces valeurs viennent directement de l’économie, des circulations et des rames de ta sauvegarde.</p></div></div><div class="mk-stat-grid">${this._stat('Voyageurs transportés', fmt(g.totalPassengers), 'people')}${this._stat('Recettes billets', euro(g.totalTicketRevenue), 'ticket')}${this._stat('Services voyageurs', fmt(g.passengerServices), 'train')}${this._stat('Occupation live', pct(g.occupancy), 'people')}${this._stat('Propreté rames', `${Math.round(g.cleanliness)}/100`, 'sparkles')}${this._stat('Annulations constatées', fmt(g.cancelled), 'warning')}</div></section><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('target', 18)} Pilotage commercial</h3><p class="marketing-sub">Les tarifs, la fidélité, le service client et la communication verte modifient les indicateurs. Le positionnement marque est une description libre sans effet économique.</p></div></div><div class="mk-settings">${this._select('farePolicy', 'Politique tarifaire', this.settings.farePolicy, [['éco', 'Éco / volume'], ['équilibrée', 'Équilibrée'], ['premium', 'Premium / valeur']])}${this._select('compensationPolicy', 'Compensation retard', this.settings.compensationPolicy, [['minimale', 'Minimale'], ['équilibrée', 'Équilibrée'], ['généreuse', 'Généreuse']])}${this._select('loyaltyProgram', 'Programme fidélité', this.settings.loyaltyProgram, [['aucun', 'Aucun'], ['simple', 'Rail Points'], ['premium', 'Premium / statuts']])}${this._select('brandPositioning', 'Positionnement marque (descriptif)', this.settings.brandPositioning, [['accessible', 'Accessible'], ['généraliste', 'Généraliste'], ['premium', 'Premium'], ['écologique', 'Écologique']])}${this._select('customerCare', 'Service client', this.settings.customerCare, [['standard', 'Standard'], ['renforcé', 'Renforcé'], ['excellence', 'Excellence']])}<label class="mk-toggle"><span><b>Communication environnementale</b><small>Valorise sobriété énergétique et report modal.</small></span><input type="checkbox" data-mk-setting="greenCommunication" ${this.settings.greenCommunication ? 'checked' : ''}></label></div><div class="mk-impact"><span>Tarif moyen ×<b>${this.stats.fareMultiplier.toFixed(2)}</b></span><span>Demande voyageurs ×<b>${this.stats.demandMultiplier.toFixed(2)}</b></span><span>Offres actives <b>${this.stats.activeOffers}</b></span><span>Services actifs <b>${this.stats.activeFeatures}</b></span></div></section><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('warning', 18)} Centre d’attention</h3><p class="marketing-sub">Priorités calculées depuis les métriques actuelles.</p></div></div><div class="mk-alerts">${alerts.map(a => `<article class="mk-alert ${a[0]}"><b>${esc(a[1])}</b><span>${esc(a[2])}</span></article>`).join('')}</div></section><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('money', 18)} Économie marketing — dernier jour</h3><p class="marketing-sub">Recettes et coûts réellement injectés dans l’économie de la partie au règlement journalier.</p></div></div><div class="mk-stat-grid">${this._stat('Voyageurs du jour', fmt(this.stats.dailyPassengers), 'people')}${this._stat('Restauration', euro(this.stats.onboardRevenueToday), 'restaurant')}${this._stat('Publicité', euro(this.stats.adRevenueToday), 'ads')}${this._stat('Coût produits', euro(this.stats.onboardCostToday), 'cargo')}${this._stat('Budget & services', euro(this.stats.marketingSpendToday), 'megaphone')}${this._stat('Résultat annexe', euro(this.stats.netMarketingToday), 'money')}</div></section>${this._renderGallery()}</div>`; }
    _renderPhotography() {
        const scenes = [
            ['voyage-interieur.webp', 'Voyage à bord', 'Vue illustrative d’un intérieur de train voyageurs'],
            ['gare-quai.webp', 'Départ en gare', 'Vue illustrative d’un train à quai'],
            ['restauration-bord.webp', 'Pause à bord', 'Vue illustrative d’une collation dans un train'],
        ];
        return `<section class="marketing-panel wide mk-photo-panel"><div class="marketing-head"><div><h3>${icon('sparkles', 18)} Ambiances ferroviaires</h3><p class="marketing-sub">Photos d’illustration (visuels de synthèse), sans lien avec tes rames ni tes résultats. Les services et chiffres réels de ta partie figurent ci-dessous.</p></div></div><div class="mk-photo-grid">${scenes.map(([filename, title, alt]) => `<figure class="mk-photo-card"><img src="img/marketing/${filename}" alt="${esc(alt)}" width="960" height="540" loading="lazy" decoding="async"><figcaption>${esc(title)}</figcaption></figure>`).join('')}</div></section>`;
    }
    _renderGallery() {
        const cards = this._galleryTrains.map(train => `<figure class="mk-gallery-card"><div class="mk-gallery-scene"><img src="${esc(train.imageSrc)}" alt="${esc(train.isOwnImage ? `Matériel de ${train.rameName}` : 'Illustration locale de train voyageurs')}" loading="lazy" decoding="async"></div><figcaption><strong>${esc(train.name)}</strong><span>${esc(train.rameName)} · ${pct(train.occupancy)} d’occupation · ${train.delay > 5 ? `Retard ${fmt(train.delay)} min` : Math.abs(train.delay) <= 5 ? 'À ±5 min' : `Avance ${fmt(Math.abs(train.delay))} min`}</span></figcaption></figure>`).join('');
        return `<section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('train', 18)} Services voyageurs en images</h3><p class="marketing-sub">Trains actifs de cette partie. Visuel de la rame quand il est disponible, sinon illustration locale ; occupation et retard issus de la circulation en cours.</p></div></div>${cards ? `<div class="mk-gallery">${cards}</div>` : '<div class="mk-empty">Aucun service voyageurs actif à illustrer actuellement.</div>'}</section>`;
    }
    _renderOnboard() { const activeFeatures = this.features.filter(x => x.active); const foods = this.catering; return `<div class="marketing-sections"><section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('sparkles', 18)} Services et équipements à bord</h3><p class="marketing-sub">Chaque service a un coût par voyageur et agit sur satisfaction/demande.</p></div><div class="marketing-badges"><span class="mk-badge good">${activeFeatures.length} actifs</span><span class="mk-badge">Coût ${fmt(activeFeatures.reduce((z, x) => z + x.costPerPassenger, 0), 2)} €/voyageur</span></div></div><div class="mk-catalog">${this.features.map(f => `<article class="mk-card"><div class="mk-card-top"><div><b>${esc(f.id === stableId('feature', 'Compensation automatique') || f.name === 'Compensation automatique' ? 'Suivi commercial des compensations' : f.name)}</b><div class="mk-mini">${esc(f.category)}</div></div><span class="mk-badge ${f.active ? 'good' : 'mid'}">${f.active ? 'Actif' : 'Inactif'}</span></div><p>${esc(f.description)}</p><div class="mk-meta"><span>${icon('money', 12)} ${fmt(f.costPerPassenger, 3)} €/voy.</span><span>${icon('heart', 12)} +${f.satisfactionBoost} sat.</span><span>${icon('people', 12)} +${f.demandBoost} demande</span></div><div class="mk-actions"><button data-mk-action="toggle-feature" data-id="${esc(f.id)}" class="${f.active ? 'warn' : 'good'}">${f.active ? 'Désactiver' : 'Activer'}</button></div></article>`).join('')}</div></section><section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('restaurant', 18)} Carte de restauration à bord</h3><p class="marketing-sub">${foods.length} références disponibles. Prix, coût, qualité, sourcing et ventes du dernier jour sont gérés par produit.</p></div><div class="marketing-badges"><span class="mk-badge">${foods.filter(x => x.active).length} à la carte</span><span class="mk-badge">${foods.filter(x => x.bestseller).length} best-sellers</span></div></div><div class="mk-food-table">${foods.map(i => `<article class="mk-food-row"><div class="mk-food-name"><b>${esc(i.name)}</b><span>${esc(i.category)}${i.local ? ' · local' : ''}${i.vegetarian ? ' · végétarien' : ''}</span></div><label>Prix<input data-food-field="price" data-id="${esc(i.id)}" type="number" step="0.1" value="${i.price}"></label><label>Coût<input data-food-field="cost" data-id="${esc(i.id)}" type="number" step="0.1" value="${i.cost}"></label><label>Qualité<input data-food-field="quality" data-id="${esc(i.id)}" type="number" min="10" max="100" value="${i.quality}"></label><div class="mk-food-sales"><b>${i.salesToday}</b><span>ventes/j</span></div><div class="mk-actions"><button data-mk-action="save-food" data-id="${esc(i.id)}">Enregistrer</button><button data-mk-action="toggle-food" data-id="${esc(i.id)}" class="${i.active ? 'warn' : 'good'}">${i.active ? 'Retirer' : 'Activer'}</button><button data-mk-action="bestseller-food" data-id="${esc(i.id)}">${icon('star', 12, i.bestseller ? 'filled' : '')} Best-seller</button>${this._isDefaultFoodId(i.id) ? '' : `<button data-mk-action="delete-food" data-id="${esc(i.id)}" class="warn">Supprimer</button>`}</div></article>`).join('')}</div><details class="mk-add"><summary>+ Ajouter un produit personnalisé</summary><form class="mk-form" data-mk-form="food"><label><span>Nom</span><input name="name" required></label><label><span>Catégorie</span><input name="category" value="Snack"></label><label><span>Prix</span><input name="price" type="number" step="0.1" value="5"></label><label><span>Coût</span><input name="cost" type="number" step="0.1" value="2"></label><label><span>Qualité</span><input name="quality" type="number" min="10" max="100" value="80"></label><label class="mk-toggle"><span>Local</span><input type="checkbox" name="local"></label><label class="mk-toggle"><span>Végétarien</span><input type="checkbox" name="vegetarian"></label><div class="wide"><button type="submit">Ajouter</button></div></form></details></section></div>`; }
    _isDefaultOfferId(id) { return DEFAULT_OFFERS.some(x => stableId('offer', x.name) === id); }
    _isDefaultFoodId(id) { return DEFAULT_FOOD.some(x => stableId('food', x.name) === id); }
    _renderCommercialOffers() {
        const cards = this.serviceOffers.map(o => `<article class="mk-card"><div class="mk-card-top"><div><b>${esc(o.name)}</b><div class="mk-mini">${o.category === 'fret' ? 'Fret' : 'Voyageurs'}${o.category === 'fret' ? ' · rame ≥ ' + o.minSpeedKmh + ' km/h' : ''}</div></div><span class="mk-badge ${o.active ? 'good' : 'mid'}">${o.active ? 'Active' : 'Inactive'}</span></div><div class="mk-meta"><span>Tarif ${o.fareDeltaPct >= 0 ? '+' : ''}${o.fareDeltaPct} %</span><span>Demande ${o.demandDeltaPct >= 0 ? '+' : ''}${o.demandDeltaPct} %</span><span>${o.scheduleIds.length} horaire(s) SC</span></div><div class="mk-actions"><button type="button" data-mk-commercial-action="toggle" data-id="${esc(o.id)}">${o.active ? 'Désactiver' : 'Activer'}</button><button type="button" data-mk-commercial-action="delete" data-id="${esc(o.id)}" class="warn">Supprimer</button></div></article>`).join('') || '<p class="mk-empty">Créez une offre puis affectez-la à un ou plusieurs horaires dans Schedule Creator.</p>';
        return `<section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('ticket', 18)} Offres commerciales par train</h3><p class="marketing-sub">Voyageurs ou Fret, tarif et demande réels. Affectez-les aux trains depuis le bouton « Offres » du Schedule Creator. Un fret express exige une rame assez rapide.</p></div><span class="mk-badge">${this.serviceOffers.length} offre(s)</span></div><div class="mk-catalog">${cards}</div><details class="mk-add"><summary>+ Créer une offre commerciale</summary><form class="mk-form" data-mk-commercial-form><label><span>Nom</span><input name="name" maxlength="90" required></label><label><span>Catégorie</span><select name="category"><option value="voyageur">Voyageurs</option><option value="fret">Fret</option></select></label><label><span>Tarif (%)</span><input name="fareDeltaPct" type="number" min="-50" max="50" value="0" required></label><label><span>Demande (%)</span><input name="demandDeltaPct" type="number" min="-50" max="100" value="0" required></label><label data-mk-commercial-speed><span>Vitesse minimale Fret (km/h)</span><input name="minSpeedKmh" type="number" min="0" max="300" value="100"></label><div class="wide"><button type="submit">Créer</button></div></form></details></section>`;
    }
    openScheduleOfferDialog(scheduleId, game) {
        if (typeof document === 'undefined')
            return;
        const schedule = game.scheduleV2?.getSchedule?.(scheduleId);
        if (!schedule)
            return;
        const version = schedule.currentVersion;
        const category = this._commercialCategory(version?.category);
        const direct = game.rotationV2?.getDirectAssignment?.(schedule.id, version.id);
        const directRame = direct?.rameId ? game.rameManager?.getById?.(direct.rameId) : null;
        const plannedSpeed = n(version?.performanceProfile?.maxSpeed);
        const actualSpeed = n(directRame?.maxSpeed);
        const maxSpeed = actualSpeed && plannedSpeed ? Math.min(actualSpeed, plannedSpeed) : (actualSpeed || plannedSpeed);
        const eligible = this.serviceOffers.filter(o => o.category === category);
        document.getElementById('re-schedule-offers-dialog')?.remove();
        const modal = document.createElement('div');
        modal.id = 're-schedule-offers-dialog';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9500;background:#000b;display:flex;align-items:center;justify-content:center';
        const rows = eligible.map(o => {
            const tooSlow = o.category === 'fret' && maxSpeed < o.minSpeedKmh;
            return `<label style="display:block;padding:9px;margin:6px 0;border:1px solid #38516d;border-radius:6px;opacity:${tooSlow ? '.55' : '1'}"><input type="checkbox" data-commercial-offer="${esc(o.id)}" ${o.scheduleIds.includes(schedule.id) ? 'checked' : ''} ${tooSlow ? 'disabled' : ''}> <b>${esc(o.name)}</b> · tarif ${o.fareDeltaPct >= 0 ? '+' : ''}${o.fareDeltaPct}% · demande ${o.demandDeltaPct >= 0 ? '+' : ''}${o.demandDeltaPct}%${tooSlow ? ' · rame trop lente (' + o.minSpeedKmh + ' km/h requis)' : ''}</label>`;
        }).join('') || '<p>Créez d’abord une offre de cette catégorie dans Marketing → Offres clients.</p>';
        modal.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Offres commerciales" style="width:min(550px,94vw);max-height:85vh;overflow:auto;background:#0d1928;color:#eef6ff;border:1px solid #38516d;border-radius:10px;padding:16px"><h3>Offres commerciales · ${esc(schedule.number || schedule.name || 'Horaire')}</h3><p>Rame / profil : ${maxSpeed} km/h · ${esc(category === 'fret' ? 'Fret' : 'Voyageurs')}. Choisissez une ou plusieurs offres pour cet horaire.</p>${rows}<p data-commercial-error role="status" style="color:#fca5a5"></p><button type="button" data-commercial-close>Fermer</button></div>`;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('[data-commercial-close]')?.addEventListener('click', close);
        modal.addEventListener('click', (event) => { if (event.target === modal)
            close(); });
        modal.querySelectorAll('[data-commercial-offer]').forEach(raw => {
            const node = raw;
            node.addEventListener('change', () => {
                const result = this.assignCommercialOffer(node.dataset.commercialOffer || '', { id: schedule.id, category, maxSpeed }, node.checked);
                if (!result.ok) {
                    node.checked = !node.checked;
                    const error = modal.querySelector('[data-commercial-error]');
                    if (error)
                        error.textContent = result.message;
                    return;
                }
                game.saveState?.();
            });
        });
    }
    _renderOffers() { return `<section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('ticket', 18)} Catalogue d’offres clients</h3><p class="marketing-sub">Tarifs, abonnements, fidélité, promotions et services commerciaux. Les offres actives alimentent réellement le multiplicateur de demande et, légèrement, le niveau tarifaire moyen.</p></div><div class="marketing-badges"><span class="mk-badge good">${this.stats.activeOffers} actives</span><span class="mk-badge">${this.offers.length} disponibles</span></div></div><div class="mk-catalog">${this.offers.map(o => `<article class="mk-card ${o.featured ? 'featured' : ''}"><div class="mk-card-top"><div><b>${esc(o.name)}</b><div class="mk-mini">${esc(o.type)} · ${esc(o.target)}</div></div><span class="mk-badge ${o.active ? 'good' : 'mid'}">${o.active ? 'Active' : 'Inactive'}</span></div><p>${esc(o.description)}</p><div class="mk-meta"><span>${icon('tag', 12)} tarif ${o.priceDeltaPct >= 0 ? '+' : ''}${o.priceDeltaPct}%</span><span>${icon('people', 12)} demande +${o.demandBoost}</span><span>${icon('heart', 12)} sat. +${o.satisfactionBoost}</span></div><div class="mk-actions"><button data-mk-action="toggle-offer" data-id="${esc(o.id)}" class="${o.active ? 'warn' : 'good'}">${o.active ? 'Désactiver' : 'Activer'}</button><button data-mk-action="duplicate-offer" data-id="${esc(o.id)}">Dupliquer</button>${this._isDefaultOfferId(o.id) ? '' : `<button data-mk-action="delete-offer" data-id="${esc(o.id)}" class="warn">Supprimer</button>`}</div></article>`).join('')}</div><details class="mk-add"><summary>+ Créer une offre personnalisée</summary><form class="mk-form" data-mk-form="offer"><label><span>Nom</span><input name="name" required></label><label><span>Type</span><select name="type">${offerTypes.map(x => `<option>${esc(x)}</option>`).join('')}</select></label><label><span>Cible</span><select name="target">${audiences.map(x => `<option>${esc(x)}</option>`).join('')}</select></label><label class="wide"><span>Description</span><input name="description" required></label><label><span>Écart tarif %</span><input name="priceDeltaPct" type="number" value="0" min="-50" max="50"></label><label><span>Boost demande</span><input name="demandBoost" type="number" value="5" min="-20" max="40"></label><label><span>Boost satisfaction</span><input name="satisfactionBoost" type="number" value="3" min="-10" max="20"></label><div class="wide"><button type="submit">Créer et activer</button></div></form></details></section>`; }
    _renderCampaigns() { return `<div class="marketing-sections"><section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('megaphone', 18)} Campagnes actives & historiques</h3><p class="marketing-sub">Budgets débités chaque jour. Les campagnes voyageurs jouent sur la demande, la notoriété et la satisfaction marketing (gain cumulé plafonné à 30 points) ; une campagne fret développe la demande des chargeurs.</p></div><span class="mk-badge">${euro(this.campaigns.filter(x => x.active).reduce((z, x) => z + x.budgetPerDay, 0))}/jour</span></div><div class="mk-catalog">${this.campaigns.map(c => `<article class="mk-card"><div class="mk-card-top"><div><b>${esc(c.name)}</b><div class="mk-mini">${esc(c.channel)} · ${esc(c.target)} · ${esc(c.objective)}</div></div><span class="mk-badge ${c.active ? 'good' : 'mid'}">${c.active ? `${c.daysRemaining} j` : 'Terminée'}</span></div><div class="mk-meta"><span>${euro(c.budgetPerDay)}/j</span>${c.target === 'Fret' ? `<span>Demande fret +${c.demandGain} %</span>` : `<span>Notoriété +${c.awarenessGain}</span><span>Demande +${c.demandGain}</span><span>Satisfaction +${c.satisfactionGain}</span>`}</div><div class="mk-actions"><button data-mk-action="${c.active ? 'stop-campaign' : 'restart-campaign'}" data-id="${esc(c.id)}" class="${c.active ? 'warn' : 'good'}">${c.active ? 'Arrêter' : 'Relancer'}</button></div></article>`).join('') || '<div class="mk-empty">Aucune campagne créée.</div>'}</div></section><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('target', 18)} Campagnes prêtes à lancer</h3><p class="marketing-sub">Modèles rapides avec budgets et objectifs préconfigurés.</p></div></div><div class="mk-preset-list">${CAMPAIGN_PRESETS.map((p, i) => `<button data-mk-action="preset-campaign" data-index="${i}"><b>${esc(p[0])}</b><span>${esc(p[1])} · ${esc(p[2])} · ${euro(p[4])}/j</span></button>`).join('')}</div></section><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('plus', 18)} Campagne personnalisée</h3></div></div><form class="mk-form" data-mk-form="campaign"><label><span>Nom</span><input name="name" required></label><label><span>Canal</span><select name="channel"><option>Digital</option><option>TV</option><option>Radio</option><option>Affichage</option><option>Presse</option><option>Social</option><option>Influence</option><option>CRM / E-mail</option><option>Partenariat</option></select></label><label><span>Cible</span><select name="target">${campaignAudiences.map(x => `<option>${esc(x)}</option>`).join('')}</select></label><label><span>Objectif</span><select name="objective"><option>Notoriété</option><option>Conversion</option><option>Acquisition</option><option>Rétention</option><option>Image de marque</option><option>Lancement offre</option></select></label><label><span>Budget/j (€)</span><input name="budgetPerDay" type="number" value="10000" min="500"></label><label><span>Durée (jours)</span><input name="durationDays" type="number" value="14" min="1" max="120"></label><label data-mk-passenger-campaign><span>Gain notoriété voyageurs</span><input name="awarenessGain" type="number" value="5" min="1" max="25"></label><label><span>Gain demande</span><input name="demandGain" type="number" value="5" min="0" max="30"></label><label data-mk-passenger-campaign><span>Gain satisfaction voyageurs</span><input name="satisfactionGain" type="number" value="1" min="0" max="10"></label><div class="wide"><button type="submit">Lancer</button></div></form></section></div>`; }
    _renderAds() {
        const policy = this._simpleAdvertising
            ? 'Mode Simple : contrats libres, prix libre et recettes sans condition d’audience.'
            : 'Expert / Ultra : prix limité à l’audience voyageurs réellement transportée et aux équipements ou dessertes disponibles. Plafond déterministe : à bord 0,015 €, gare 0,012 €, digital 0,008 € par voyageur. Chaque jour, la recette est limitée au prix signé et à l’audience du jour ; sans trafic, aucune recette.';
        return `<section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('ads', 18)} Régie publicitaire</h3><p class="marketing-sub">${esc(policy)}</p></div><div class="marketing-badges"><span class="mk-badge good">${euro(this.stats.adRevenueToday)}/jour</span><span class="mk-badge">${this.adSlots.filter(x => x.active).length} contrats</span></div></div>${this._adMessage ? `<p class="marketing-sub" role="status" data-mk-ad-message>${esc(this._adMessage)}</p>` : ''}<div class="mk-ad-grid">${this.adSlots.map(a => `<article class="mk-card"><div class="mk-card-top"><div><b>${esc(a.name)}</b><div class="mk-mini">${esc(a.placement)} · ${esc(a.format)}</div></div><span class="mk-badge ${a.active ? 'good' : 'mid'}">${a.active ? `${a.daysRemaining} j` : 'Disponible'}</span></div>${this._simpleAdvertising ? '' : `<p class="mk-mini">Plafond actuel : ${fmt(this._adQuotes[a.id] || 0, 2)} €/jour · audience en cours, ou dernier jour réglé. À bord : rame voyageurs requise ; en gare : desserte voyageurs requise. Portail Wi-Fi et salon : service correspondant actif.</p>`}<label class="mk-inline-field">Annonceur<input data-ad-field="advertiser" data-id="${esc(a.id)}" value="${esc(a.advertiser)}" placeholder="Nom annonceur"></label><label class="mk-inline-field">Prix / jour<input data-ad-field="dailyPrice" data-id="${esc(a.id)}" type="number" value="${a.dailyPrice}" min="0"></label><label class="mk-inline-field">Durée<input data-ad-field="contractDays" data-id="${esc(a.id)}" type="number" value="${a.contractDays}" min="1" max="365"></label><div class="mk-actions"><button data-mk-action="save-ad" data-id="${esc(a.id)}">Enregistrer</button><button data-mk-action="toggle-ad" data-id="${esc(a.id)}" class="${a.active ? 'warn' : 'good'}">${a.active ? 'Résilier' : 'Signer le contrat'}</button></div></article>`).join('')}</div></section>`;
    }
    _renderSatisfaction() { const d = this._dimensions, g = this._liveSnapshot; const hist = this.history.slice(-20); return `<div class="marketing-sections"><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('heart', 18)} Satisfaction détaillée</h3><p class="marketing-sub">Score global ancré sur la satisfaction voyageur native de RE puis enrichi avec les dimensions marketing. Les gains de satisfaction du dernier jour de campagne réglé sont conservés jusqu’au règlement suivant.${this._lastDeliveredQuality ? ` Qualité des derniers transports observés : ${esc(this._lastDeliveredQuality.date)} ; elle reste conservée en l’absence de nouveau transport.` : ''}</p></div><span class="mk-score-big ${this._tone(d.global)}">${d.global}/100</span></div><div class="mk-dimensions">${Object.entries(d).filter(([k]) => k !== 'global').map(([k, v]) => `<div><span>${esc(this._dimensionLabel(k))}</span><div class="mk-bar"><i style="width:${clamp(v, 0, 100)}%"></i></div><b>${v}</b></div>`).join('')}</div></section><section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('train', 18)} Ce qui vient réellement du jeu</h3></div></div><div class="mk-stat-grid">${this._stat('Satisfaction RE', `${Math.round(g.passengerSatisfaction)}/100`, 'heart')}${this._stat('Ponctualité', pct(g.punctuality), 'clock')}${this._stat('Retard moyen', `${fmt(g.avgDelay, 1)} min`, 'clock')}${this._stat('Propreté', `${Math.round(g.cleanliness)}/100`, 'sparkles')}${this._stat('Occupation', pct(g.occupancy), 'people')}${this._stat('Voyageurs cumulés', fmt(g.totalPassengers), 'people')}</div></section><section class="marketing-panel wide"><div class="marketing-head"><div><h3>${icon('chart', 18)} Historique marketing</h3><p class="marketing-sub">Les 20 derniers règlements journaliers conservés.</p></div></div>${hist.length ? `<div class="mk-history">${hist.map(h => `<article><span>${esc(h.date)}</span><div title="Satisfaction ${h.satisfaction}"><i style="height:${Math.max(4, h.satisfaction)}%"></i></div><b>${h.satisfaction}</b><small>${fmt(h.passengers)} voy.</small></article>`).join('')}</div>` : '<div class="mk-empty">L’historique se remplira au fil des journées de jeu.</div>'}</section></div>`; }
    _renderFeedback() {
        const customerReviews = this.feedbacks.filter(f => !this._isFreightSummary(f));
        const summaryCount = this.feedbacks.length - customerReviews.length;
        const cards = this.feedbacks.map(f => {
            const summary = this._isFreightSummary(f);
            return `<article class="mk-review"><div class="mk-review-title"><div><b>${esc(f.title)}</b><div class="mk-mini">${esc(f.author)} · ${esc(f.date)} · ${f.serviceCategory === 'fret' ? 'Fret' : 'Voyageurs'} · ${summary ? 'Bilan des livraisons' : f.experience === 'journey' ? 'Avis après voyage' : f.experience === 'disruption' ? 'Perturbation constatée' : f.experience === 'survey' || f.origin === 'solicited' ? 'Sondage sur l’offre' : 'Transport réalisé'} · ${esc(f.category)}${f.serviceName ? ` · ${esc(f.serviceName)}` : ''}</div></div>${summary ? '' : `<div class="mk-rating" aria-label="${f.rating} sur 5">${Array.from({ length: 5 }, (_, i) => icon('star', 14, i < f.rating ? 'filled' : '')).join('')}</div>`}</div><p>${esc(f.message)}</p>${summary ? '' : `${f.responseText ? `<div class="mk-response"><b>Réponse compagnie</b><span>${esc(f.responseText)}</span></div>` : ''}<div class="mk-actions"><span class="mk-badge ${f.status === 'new' ? 'bad' : f.status === 'replied' ? 'mid' : 'good'}">${f.status === 'new' ? 'À traiter' : f.status === 'replied' ? 'Répondu' : 'Clôturé'}</span><button data-mk-action="reply-feedback" data-id="${esc(f.id)}" ${f.responded ? 'disabled' : ''}>Répondre</button><button data-mk-action="close-feedback" data-id="${esc(f.id)}">Clôturer</button></div>`}</article>`;
        }).join('');
        return `<section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('message', 18)} Avis voyageurs & retours sur l’offre</h3><p class="marketing-sub">Les avis voyageurs décrivent les trajets enregistrés : train, arrivée et qualité à bord. Solliciter un avis voyageurs interroge des voyageurs ayant terminé un trajet ; sans trajet enregistré, un sondage sur les offres reste disponible. Les bilans fret sont des indicateurs de livraison, pas des témoignages de chargeurs.</p></div><div class="marketing-badges"><span class="mk-badge">Moyenne ${customerReviews.length ? this.stats.averageFeedback.toFixed(1) : '—'}/5 · ${customerReviews.length} avis simulés${summaryCount ? ` · ${summaryCount} bilan(s) fret` : ''}</span><span class="mk-badge">Réponse ${Math.round(this.stats.replyRate)}%</span><button data-mk-action="generate-feedback">Solliciter un avis voyageurs</button><button data-mk-action="generate-freight-feedback">Solliciter un avis fret</button></div></div><div class="mk-review-list">${cards || '<div class="mk-empty">Aucun avis pour le moment.</div>'}</div></section>`;
    }
    _renderPress() { return `<section class="marketing-panel"><div class="marketing-head"><div><h3>${icon('newspaper', 18)} Revue de presse</h3><p class="marketing-sub">Articles automatiques fondés sur le trafic réel ; opérations presse manuelles sur la stratégie commerciale, disponibles même sans circulation.</p></div><div class="marketing-badges"><span class="mk-badge">Score ${this.stats.pressScore}/100</span><button data-mk-action="press-trip">Organiser une opération presse voyageurs · 25 000 €</button><button data-mk-action="press-trip-freight">Organiser une opération presse fret · 25 000 €</button></div></div><div class="mk-press-list">${this.pressReviews.map(p => `<article class="mk-press ${p.tone}"><div><span>${esc(p.media)} · ${esc(p.date)} · ${p.serviceCategory === 'fret' ? 'Fret' : 'Voyageurs'} · ${p.origin === 'solicited' ? 'Opération presse' : 'Transport réalisé'}</span><b>${esc(p.title)}</b><p>${esc(p.excerpt)}</p></div><strong>${p.score}/100</strong></article>`).join('') || '<div class="mk-empty">Aucun article publié pour le moment.</div>'}</div></section>`; }
    _kpi(label, value, small, ic) { return `<div class="marketing-kpi"><span class="label">${icon(ic, 16)} ${esc(label)}</span><b>${esc(value)}</b><small>${esc(small)}</small></div>`; }
    _stat(label, value, ic) { return `<div class="mk-stat"><span>${icon(ic, 15)} ${esc(label)}</span><b>${esc(value)}</b></div>`; }
    _select(key, label, value, opts) { return `<label class="mk-setting"><span>${esc(label)}</span><select data-mk-setting="${esc(key)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`; }
    _bind(container, game) {
        container.querySelectorAll('[data-mk-tab]').forEach(el => el.addEventListener('click', () => { this._tab = (el.getAttribute('data-mk-tab') || 'overview'); this.render(container, game); }));
        container.querySelectorAll('[data-mk-setting]').forEach(el => el.addEventListener('change', () => { const node = el; const key = node.getAttribute('data-mk-setting'); if (!key)
            return; this.settings[key] = node instanceof HTMLInputElement && node.type === 'checkbox' ? node.checked : node.value; this.syncFromGame(game); game.saveState?.(); this.render(container, game); }));
        const campaignForm = container.querySelector('[data-mk-form="campaign"]');
        const campaignTarget = campaignForm?.querySelector('[name="target"]');
        campaignTarget?.addEventListener('change', () => campaignForm?.querySelectorAll('[data-mk-passenger-campaign]').forEach(row => {
            row.style.display = campaignTarget.value === 'Fret' ? 'none' : '';
            const input = row.querySelector('input');
            if (input)
                input.disabled = campaignTarget.value === 'Fret';
        }));
        if (campaignTarget)
            campaignTarget.dispatchEvent(new Event('change'));
        const commercialForm = container.querySelector('[data-mk-commercial-form]');
        const commercialCategory = commercialForm?.querySelector('[name="category"]');
        commercialCategory?.addEventListener('change', () => { const speed = commercialForm?.querySelector('[data-mk-commercial-speed]'); if (speed)
            speed.style.display = commercialCategory.value === 'fret' ? '' : 'none'; });
        if (commercialCategory)
            commercialCategory.dispatchEvent(new Event('change'));
        commercialForm?.addEventListener('submit', event => {
            event.preventDefault();
            const form = new FormData(commercialForm);
            this.addCommercialOffer({ name: s(form.get('name')), category: s(form.get('category')), fareDeltaPct: n(form.get('fareDeltaPct')), demandDeltaPct: n(form.get('demandDeltaPct')), minSpeedKmh: n(form.get('minSpeedKmh')) });
            game.saveState?.();
            this.render(container, game, 'commercial');
        });
        container.querySelectorAll('[data-mk-commercial-action]').forEach(node => node.addEventListener('click', () => {
            const id = node.getAttribute('data-id') || '', offer = this.serviceOffers.find(o => o.id === id);
            if (!offer)
                return;
            if (node.getAttribute('data-mk-commercial-action') === 'delete')
                this.serviceOffers = this.serviceOffers.filter(o => o.id !== id);
            else
                offer.active = !offer.active;
            game.saveState?.();
            this.render(container, game);
        }));
        container.querySelector('[data-mk-form="food"]')?.addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); this.catering.unshift({ id: randId('food'), name: s(fd.get('name'), 'Produit'), category: s(fd.get('category'), 'Snack'), price: clamp(n(fd.get('price'), 5), .1, 100), cost: clamp(n(fd.get('cost'), 2), 0, 100), quality: clamp(Math.round(n(fd.get('quality'), 80)), 10, 100), local: !!fd.get('local'), vegetarian: !!fd.get('vegetarian'), active: true, bestseller: false, salesToday: 0 }); game.saveState?.(); this.render(container, game, 'food'); });
        container.querySelector('[data-mk-form="offer"]')?.addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); this.offers.unshift({ id: randId('offer'), name: s(fd.get('name'), 'Offre'), type: (offerTypes.includes(s(fd.get('type'))) ? s(fd.get('type')) : 'tarif'), target: (audiences.includes(s(fd.get('target'))) ? s(fd.get('target')) : 'Tous'), description: s(fd.get('description'), 'Offre personnalisée.'), priceDeltaPct: clamp(n(fd.get('priceDeltaPct')), -50, 50), demandBoost: clamp(n(fd.get('demandBoost'), 5), -20, 40), satisfactionBoost: clamp(n(fd.get('satisfactionBoost'), 3), -10, 20), active: true, featured: false }); this._recomputeDerived(); game.saveState?.(); this.render(container, game, 'offer'); });
        container.querySelector('[data-mk-form="campaign"]')?.addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.currentTarget); this._addCampaign({ name: s(fd.get('name'), 'Campagne'), channel: s(fd.get('channel'), 'Digital'), target: s(fd.get('target'), 'Tous'), objective: s(fd.get('objective'), 'Notoriété'), budgetPerDay: n(fd.get('budgetPerDay'), 10000), durationDays: n(fd.get('durationDays'), 14), awarenessGain: n(fd.get('awarenessGain'), 5), demandGain: n(fd.get('demandGain'), 5), satisfactionGain: n(fd.get('satisfactionGain'), 1) }, dateText(game._currentDate)); game.saveState?.(); this.render(container, game, 'campaign'); });
        container.querySelectorAll('[data-mk-action]').forEach(el => el.addEventListener('click', () => {
            const action = el.getAttribute('data-mk-action') || '', id = el.getAttribute('data-id') || '';
            if (action === 'toggle-feature') {
                const x = this.features.find(v => v.id === id);
                if (x)
                    x.active = !x.active;
            }
            else if (action === 'toggle-offer') {
                const x = this.offers.find(v => v.id === id);
                if (x)
                    x.active = !x.active;
            }
            else if (action === 'duplicate-offer') {
                const x = this.offers.find(v => v.id === id);
                if (x)
                    this.offers.unshift({ ...x, id: randId('offer'), name: `${x.name} — variante`, active: false, featured: false });
            }
            else if (action === 'delete-offer') {
                this.offers = this.offers.filter(v => v.id !== id);
            }
            else if (action === 'toggle-food') {
                const x = this.catering.find(v => v.id === id);
                if (x)
                    x.active = !x.active;
            }
            else if (action === 'delete-food') {
                if (!this._isDefaultFoodId(id))
                    this.catering = this.catering.filter(v => v.id !== id);
            }
            else if (action === 'bestseller-food') {
                const x = this.catering.find(v => v.id === id);
                if (x)
                    x.bestseller = !x.bestseller;
            }
            else if (action === 'save-food') {
                const x = this.catering.find(v => v.id === id);
                if (x) {
                    x.price = clamp(n(container.querySelector(`[data-food-field="price"][data-id="${CSS.escape(id)}"]`)?.value, x.price), .1, 100);
                    x.cost = clamp(n(container.querySelector(`[data-food-field="cost"][data-id="${CSS.escape(id)}"]`)?.value, x.cost), 0, 100);
                    x.quality = clamp(Math.round(n(container.querySelector(`[data-food-field="quality"][data-id="${CSS.escape(id)}"]`)?.value, x.quality)), 10, 100);
                    for (const field of ['price', 'cost', 'quality']) {
                        const input = container.querySelector(`[data-food-field="${field}"][data-id="${CSS.escape(id)}"]`);
                        if (input)
                            input.value = String(x[field]);
                    }
                }
            }
            else if (action === 'stop-campaign') {
                const x = this.campaigns.find(v => v.id === id);
                if (x)
                    x.active = false;
            }
            else if (action === 'restart-campaign') {
                const x = this.campaigns.find(v => v.id === id);
                if (x) {
                    x.active = true;
                    x.daysRemaining = x.durationDays;
                }
            }
            else if (action === 'preset-campaign') {
                const idx = Math.max(0, Math.round(n(el.getAttribute('data-index'))));
                const p = CAMPAIGN_PRESETS[idx];
                if (p)
                    this._addCampaign({ name: p[0], channel: p[1], target: p[2], objective: p[3], budgetPerDay: p[4], durationDays: p[5], awarenessGain: p[6], demandGain: p[7], satisfactionGain: p[8] }, dateText(game._currentDate));
            }
            else if (action === 'save-ad' || action === 'toggle-ad') {
                const x = this.adSlots.find(v => v.id === id);
                if (x) {
                    if (action === 'toggle-ad' && x.active) {
                        x.active = false;
                        x.daysRemaining = x.contractDays;
                        this._adMessage = 'Contrat résilié.';
                    }
                    else if (!this._saveAdTerms(container, game, x, action === 'toggle-ad')) {
                        this.render(container, game);
                        return;
                    }
                }
            }
            else if (action === 'generate-feedback') {
                if (!this.solicitFeedback(game, 'voyageur'))
                    return;
            }
            else if (action === 'generate-freight-feedback') {
                if (!this.solicitFeedback(game, 'fret'))
                    return;
            }
            else if (action === 'reply-feedback') {
                const x = this.feedbacks.find(v => v.id === id);
                if (x) {
                    x.responded = true;
                    x.status = x.rating >= 4 ? 'closed' : 'replied';
                    x.responseText = this._companyReply(x);
                }
            }
            else if (action === 'close-feedback') {
                const x = this.feedbacks.find(v => v.id === id);
                if (x) {
                    x.responded = true;
                    x.status = 'closed';
                    if (!x.responseText)
                        x.responseText = this._companyReply(x);
                }
            }
            else if (action === 'press-trip') {
                if (typeof globalThis.confirm === 'function' && !globalThis.confirm('Lancer une opération presse voyageurs pour 25 000 € ?'))
                    return;
                if (!this.organizePress(game, 'voyageur'))
                    return;
            }
            else if (action === 'press-trip-freight') {
                if (typeof globalThis.confirm === 'function' && !globalThis.confirm('Lancer une opération presse fret pour 25 000 € ?'))
                    return;
                if (!this.organizePress(game, 'fret'))
                    return;
            }
            this.syncFromGame(game);
            game.saveState?.();
            this.render(container, game);
        }));
    }
    _addCampaign(v, day) { const duration = clamp(Math.round(n(v.durationDays, 14)), 1, 120); this.campaigns.unshift({ id: randId('campaign'), name: s(v.name, 'Campagne'), channel: s(v.channel, 'Digital'), target: (campaignAudiences.includes(s(v.target)) ? s(v.target) : 'Tous'), objective: s(v.objective, 'Notoriété'), budgetPerDay: clamp(Math.round(n(v.budgetPerDay, 10000)), 500, 2e6), durationDays: duration, daysRemaining: duration, awarenessGain: v.target === 'Fret' ? 0 : clamp(n(v.awarenessGain, 5), 1, 25), demandGain: clamp(n(v.demandGain, 5), 0, 30), satisfactionGain: v.target === 'Fret' ? 0 : clamp(n(v.satisfactionGain, 1), 0, 10), active: true, createdAt: day }); }
    _companyReply(f) { if (f.experience === 'survey' || (f.origin === 'solicited' && !f.experience))
        return 'Merci pour votre retour sur notre offre. Votre avis sur la stratégie commerciale est transmis à nos équipes.'; if (f.serviceCategory === 'fret')
        return 'Merci pour votre retour sur la livraison fret. Les livraisons et la qualité de service sont suivies par nos équipes commerciales et d’exploitation.'; if (f.rating >= 4)
        return `Merci ${f.author}. Heureux que votre expérience vous ait satisfait. Votre retour sur ${f.category.toLowerCase()} est transmis aux équipes pour maintenir ce niveau de service.`; if (f.rating === 3)
        return `Merci ${f.author} pour ce retour détaillé. Nous avons bien identifié votre remarque sur ${f.category.toLowerCase()} et l’intégrons à notre suivi qualité.`; return `Bonjour ${f.author}, merci d’avoir pris le temps de nous écrire. Nous sommes désolés que ${f.category.toLowerCase()} n’ait pas été au niveau attendu. Votre retour est enregistré comme point prioritaire et sera suivi par nos équipes.`; }
    _normOffer(v) { const x = rec(v); return { id: s(x.id, randId('offer')), name: s(x.name, 'Offre'), type: (offerTypes.includes(s(x.type)) ? s(x.type) : 'tarif'), target: (audiences.includes(s(x.target)) ? s(x.target) : 'Tous'), description: s(x.description), priceDeltaPct: clamp(n(x.priceDeltaPct), -50, 50), demandBoost: clamp(n(x.demandBoost), -20, 40), satisfactionBoost: clamp(n(x.satisfactionBoost), -10, 20), active: b(x.active, true), featured: b(x.featured, false) }; }
    _normFood(v) { const x = rec(v); return { id: s(x.id, randId('food')), name: s(x.name, 'Produit'), category: s(x.category, 'Snack'), price: clamp(n(x.price, 5), .1, 100), cost: clamp(n(x.cost, 2), 0, 100), quality: clamp(Math.round(n(x.quality, 75)), 10, 100), local: b(x.local), vegetarian: b(x.vegetarian), active: b(x.active, true), bestseller: b(x.bestseller), salesToday: Math.max(0, Math.round(n(x.salesToday))) }; }
    _normFeature(v) { const x = rec(v); return { id: s(x.id, randId('feature')), name: s(x.name, 'Service'), category: s(x.category, 'Service'), description: s(x.id) === stableId('feature', 'Compensation automatique') || s(x.name) === 'Compensation automatique' ? COMPENSATION_DESCRIPTION : s(x.description), costPerPassenger: clamp(n(x.costPerPassenger), 0, 20), satisfactionBoost: clamp(n(x.satisfactionBoost), 0, 20), demandBoost: clamp(n(x.demandBoost), 0, 20), active: b(x.active) }; }
    _normCampaign(v) { const x = rec(v), dur = clamp(Math.round(n(x.durationDays, 14)), 1, 120); return { id: s(x.id, randId('campaign')), name: s(x.name, 'Campagne'), channel: s(x.channel, 'Digital'), target: (campaignAudiences.includes(s(x.target)) ? s(x.target) : 'Tous'), objective: s(x.objective, 'Notoriété'), budgetPerDay: clamp(n(x.budgetPerDay, 10000), 500, 2e6), durationDays: dur, daysRemaining: clamp(Math.round(n(x.daysRemaining, dur)), 0, dur), awarenessGain: x.target === 'Fret' ? 0 : clamp(n(x.awarenessGain, 5), 1, 25), demandGain: clamp(n(x.demandGain, 5), 0, 30), satisfactionGain: x.target === 'Fret' ? 0 : clamp(n(x.satisfactionGain, 1), 0, 10), active: b(x.active, true), createdAt: s(x.createdAt) }; }
    _normAd(v) { const x = rec(v), days = clamp(Math.round(n(x.contractDays, 30)), 1, 365); return { id: s(x.id, randId('ad')), name: s(x.name, 'Emplacement'), placement: s(x.placement, 'À bord'), format: s(x.format, 'Display'), advertiser: s(x.advertiser), category: s(x.category, 'Display'), dailyPrice: clamp(n(x.dailyPrice, 1000), 0, 1e7), contractDays: days, daysRemaining: clamp(Math.round(n(x.daysRemaining, days)), 0, days), active: b(x.active, false) }; }
    _normFeedback(v) {
        const x = rec(v), rating = clamp(Math.round(n(x.rating, 4)), 1, 5), message = s(x.message);
        const legacyTonnes = s(x.serviceCategory) === 'fret' && s(x.category) === 'Livraison fret'
            && s(x.author) === 'Chargeur (avis simulé)'
            ? message.match(/^([\d\s\u00a0\u202f]+(?:[.,]\d+)?)\s*t de marchandises ont été effectivement livrées depuis le dernier avis, pour .* de recettes fret\./i)?.[1]?.trim()
            : undefined;
        const summary = !!legacyTonnes;
        return { id: s(x.id, randId('fb')), date: s(x.date),
            author: summary ? 'Indicateur fret' : s(x.author, 'Client'), rating: summary ? 3 : rating,
            category: summary ? 'Bilan de livraison' : s(x.category, 'Confort'),
            title: summary ? `Bilan fret : ${legacyTonnes} t livrées` : s(x.title, 'Avis client'),
            message: summary ? `${legacyTonnes} t de marchandises ont été effectivement livrées depuis le dernier bilan.` : message,
            sentiment: summary ? 'mixed' : (['positive', 'mixed', 'negative'].includes(s(x.sentiment)) ? s(x.sentiment) : rating >= 4 ? 'positive' : rating === 3 ? 'mixed' : 'negative'),
            status: (['new', 'replied', 'closed'].includes(s(x.status)) ? s(x.status) : 'new'),
            responded: b(x.responded), responseText: s(x.responseText), serviceName: s(x.serviceName),
            serviceCategory: s(x.serviceCategory) === 'fret' ? 'fret' : 'voyageur', origin: s(x.origin) === 'solicited' ? 'solicited' : 'traffic',
            experience: x.experience === 'journey' || x.experience === 'disruption' || x.experience === 'survey' ? x.experience : undefined };
    }
    _normPress(v) { const x = rec(v), score = clamp(Math.round(n(x.score, 70)), 0, 100); return { id: s(x.id, randId('press')), date: s(x.date), media: s(x.media, 'Presse'), title: s(x.title, 'Article'), excerpt: s(x.excerpt), score, tone: (['positive', 'mixed', 'negative'].includes(s(x.tone)) ? s(x.tone) : score >= 75 ? 'positive' : score >= 58 ? 'mixed' : 'negative'), serviceCategory: s(x.serviceCategory) === 'fret' ? 'fret' : 'voyageur', origin: s(x.origin) === 'solicited' ? 'solicited' : 'traffic' }; }
    _normHistory(v) { const x = rec(v); return { date: s(x.date), passengers: Math.max(0, n(x.passengers)), satisfaction: clamp(n(x.satisfaction, 70), 0, 100), awareness: clamp(n(x.awareness, 50), 0, 100), loyalty: clamp(n(x.loyalty, 50), 0, 100), punctuality: clamp(n(x.punctuality, 100), 0, 100), cateringRevenue: Math.max(0, n(x.cateringRevenue)), adRevenue: Math.max(0, n(x.adRevenue)), spend: Math.max(0, n(x.spend)), net: n(x.net) }; }
}
