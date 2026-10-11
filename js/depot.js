import { cantonManager } from './schedule-creator.js';
import { validRescueMotion, RescueMovement } from './rescue-movement.js';
import { advanceMaterialMileage } from './material-mileage.js';
import { preventiveMaintenanceReasons } from './material-maintenance.js';
import { rescuePoint, rescueDistanceKm, validatedRescueRoute, rescueRouteFailure, RESCUE_ENDPOINT_TOLERANCE_KM } from './rescue-route-contract.js';
import { normalizeRailSection, cleanRailRoute, cleanRailBinding, cloneRailValue } from './rail-section-geometry.js';
import { Rame, serviceUsesRame, serviceReferencesRame, retirePreparedRameServices } from './rame.js';
import { civilDateAt, civilRelativeSec } from './civil-game-time.js';
// Sandbox keeps accounting visible while purchases cannot be refused solely for insufficient balance.
const depotBudgetRequired = () => globalThis.window?.game?.realismSettings?.difficulty !== 'easy';
let nextDepotId = 1;
let nextRescueId = 1;
let nextDepotSupplyOrderId = 1;
// HOTFIX50 — operational depot system. Prices are gameplay/economy parameters
// kept in one catalogue so balancing can be changed without rewriting UI logic.
export const DEPOT_RESOURCE_CATALOG = Object.freeze({
    diesel_l: { label: 'Gazole', unit: 'L', price: 1.45, stock: true, defaultCapacity: 100000, category: 'Avitaillement' },
    sand_kg: { label: 'Sable de sablière', unit: 'kg', price: 0.12, stock: true, defaultCapacity: 20000, category: 'Avitaillement' },
    engine_oil_l: { label: 'Huile moteur', unit: 'L', price: 7.50, stock: true, defaultCapacity: 5000, category: 'Fluides' },
    gearbox_oil_l: { label: 'Huile de transmission / réducteur', unit: 'L', price: 8.40, stock: true, defaultCapacity: 3500, category: 'Fluides' },
    hydraulic_oil_l: { label: 'Huile hydraulique', unit: 'L', price: 6.80, stock: true, defaultCapacity: 3500, category: 'Fluides' },
    coolant_l: { label: 'Liquide de refroidissement', unit: 'L', price: 4.20, stock: true, defaultCapacity: 5000, category: 'Fluides' },
    adblue_l: { label: 'AdBlue', unit: 'L', price: 0.95, stock: true, defaultCapacity: 5000, category: 'Avitaillement' },
    washer_fluid_l: { label: 'Liquide lave-glace', unit: 'L', price: 1.80, stock: true, defaultCapacity: 2500, category: 'Fluides' },
    grease_kg: { label: 'Graisse / lubrifiant ferroviaire', unit: 'kg', price: 6.50, stock: true, defaultCapacity: 1500, category: 'Atelier' },
    penetrating_oil_l: { label: 'Dégrippant / huile fine', unit: 'L', price: 9.50, stock: true, defaultCapacity: 500, category: 'Atelier' },
    brake_cleaner_l: { label: 'Nettoyant frein / dégraissant', unit: 'L', price: 5.90, stock: true, defaultCapacity: 1000, category: 'Atelier' },
    detergent_l: { label: 'Produit lavage extérieur', unit: 'L', price: 2.80, stock: true, defaultCapacity: 3000, category: 'Nettoyage' },
    interior_cleaner_l: { label: 'Produit nettoyage intérieur', unit: 'L', price: 3.20, stock: true, defaultCapacity: 2000, category: 'Nettoyage' },
    disinfectant_l: { label: 'Désinfectant intérieur', unit: 'L', price: 4.60, stock: true, defaultCapacity: 1200, category: 'Nettoyage' },
    toilet_chemical_l: { label: 'Produit sanitaire / WC', unit: 'L', price: 3.90, stock: true, defaultCapacity: 1500, category: 'Sanitaires' },
    absorbent_kg: { label: 'Absorbant atelier', unit: 'kg', price: 1.90, stock: true, defaultCapacity: 1000, category: 'Atelier' },
    deicer_l: { label: 'Produit dégivrant', unit: 'L', price: 2.60, stock: true, defaultCapacity: 2500, category: 'Hiver' },
    water_l: { label: 'Eau réseau', unit: 'L', price: 0.004, stock: false, defaultCapacity: 0, category: 'Réseaux' },
    electricity_kwh: { label: 'Électricité', unit: 'kWh', price: 0.25, stock: false, defaultCapacity: 0, category: 'Réseaux' },
    compressed_air_m3: { label: 'Air comprimé', unit: 'm³', price: 0.08, stock: false, defaultCapacity: 0, category: 'Réseaux' },
    wastewater_l: { label: 'Traitement eaux usées', unit: 'L', price: 0.003, stock: false, defaultCapacity: 0, category: 'Réseaux' },
});
export const DEPOT_STAFF_CATALOG = Object.freeze({
    chef_equipe: { label: 'Chef d’équipe maintenance', category: 'Encadrement' },
    agent_manoeuvre: { label: 'Agent de manœuvre dépôt', category: 'Exploitation' },
    agent_visite: { label: 'Agent de visite', category: 'Maintenance' },
    agent_maintenance: { label: 'Agent de maintenance', category: 'Maintenance' },
    electromecanicien: { label: 'Électromécanicien', category: 'Maintenance' },
    mecanicien_diesel: { label: 'Mécanicien diesel', category: 'Traction thermique' },
    technicien_traction_elec: { label: 'Technicien traction électrique', category: 'Traction électrique' },
    technicien_pneumatique: { label: 'Technicien pneumatique', category: 'Freinage' },
    specialiste_freinage: { label: 'Spécialiste freinage', category: 'Freinage' },
    specialiste_essieux: { label: 'Spécialiste essieux / reprofilage', category: 'Roulement' },
    agent_levage: { label: 'Agent levage / bogies', category: 'Maintenance lourde' },
    technicien_hvac: { label: 'Technicien climatisation / HVAC', category: 'Confort' },
    chaudronnier_soudeur: { label: 'Chaudronnier / soudeur', category: 'Caisse' },
    electricien_bord: { label: 'Électricien matériel roulant', category: 'Électrique' },
    agent_avitaillement: { label: 'Agent d’avitaillement', category: 'Avitaillement' },
    agent_lavage: { label: 'Agent de lavage extérieur', category: 'Nettoyage' },
    agent_nettoyage: { label: 'Agent de nettoyage intérieur', category: 'Nettoyage' },
    agent_assainissement: { label: 'Agent sanitaires / assainissement', category: 'Nettoyage' },
    magasinier: { label: 'Magasinier pièces & consommables', category: 'Logistique' },
});
export const DEPOT_EQUIPMENT_CATALOG = Object.freeze({
    inspection_pit: { label: 'Fosse de visite', category: 'Atelier', price: 180000, maxCount: 4, description: 'Inspection sous caisse, entretien courant et organes bas.' },
    lifting_jacks: { label: 'Rampes / vérins de levage', category: 'Levage', price: 420000, maxCount: 3, description: 'Levage d’une rame ou d’un véhicule pour travaux lourds.' },
    underfloor_lathe: { label: 'Tour en fosse', category: 'Essieux', price: 950000, maxCount: 2, description: 'Reprofilage des roues sans démontage complet des essieux.' },
    wash_plant: { label: 'Station de lavage extérieur', category: 'Nettoyage', price: 360000, maxCount: 3, description: 'Portique / tunnel de lavage du matériel roulant.' },
    interior_cleaning: { label: 'Poste de nettoyage intérieur', category: 'Nettoyage', price: 90000, maxCount: 6, description: 'Quai équipé eau/électricité pour nettoyage voyageurs.' },
    fuel_station: { label: 'Station-service gazole', category: 'Avitaillement', price: 310000, maxCount: 3, description: 'Distribution sécurisée de gazole au matériel thermique.' },
    sand_station: { label: 'Station de remplissage des sablières', category: 'Avitaillement', price: 125000, maxCount: 4, description: 'Stockage et distribution de sable sec.' },
    fluid_station: { label: 'Poste fluides & lubrifiants', category: 'Avitaillement', price: 145000, maxCount: 4, description: 'Huiles, refroidissement, lave-glace et autres fluides.' },
    toilet_service: { label: 'Station sanitaires / vidange WC', category: 'Nettoyage', price: 210000, maxCount: 3, description: 'Vidange, rinçage et réapprovisionnement sanitaire.' },
    overhead_crane: { label: 'Pont roulant atelier', category: 'Levage', price: 380000, maxCount: 3, description: 'Dépose de moteurs, HVAC et organes lourds.' },
    brake_bench: { label: 'Banc freinage & pneumatique', category: 'Freinage', price: 265000, maxCount: 3, description: 'Contrôle et intervention sur freinage et circuit pneumatique.' },
    roof_access: { label: 'Passerelle toiture / accès pantographes', category: 'Électrique', price: 195000, maxCount: 4, description: 'Accès sécurisé aux équipements de toiture.' },
    electrical_bench: { label: 'Banc électrique / électronique', category: 'Électrique', price: 230000, maxCount: 4, description: 'Diagnostic traction, auxiliaires, batteries et électronique.' },
    bogie_drop: { label: 'Table de descente bogie', category: 'Bogies', price: 780000, maxCount: 2, description: 'Dépose d’un bogie sous véhicule.' },
    compressor_station: { label: 'Réseau / centrale d’air comprimé', category: 'Atelier', price: 160000, maxCount: 2, description: 'Air comprimé pour atelier, essais et outillage.' },
    deicing_station: { label: 'Station de dégivrage', category: 'Hiver', price: 280000, maxCount: 2, description: 'Traitement du matériel en conditions hivernales.' },
    battery_station: { label: 'Poste batteries / charge & essai', category: 'Électrique', price: 105000, maxCount: 3, description: 'Charge, contrôle et remplacement des batteries auxiliaires.' },
});
export const DEPOT_TRACK_EXPANSION_COST = 30000;
// Included in a new depot's construction price. Parts have no storage-capacity
// model; their initial shelf stock is ten of each catalogue reference.
export const DEPOT_CREATION_MACHINE_COUNT = 10;
export const DEPOT_CREATION_PART_COUNT = 10;
export const DEPOT_CREATION_STAFF_PER_ROLE = 90;
export const DEPOT_PART_CATALOG = Object.freeze([
    { id: 'engine_mtu_16v4000_r41', label: 'MTU 16V 4000 R41 — moteur diesel', category: 'Moteurs', price: 180000, match: /BB\s*(?:75000|75100|75300)/i, realModel: true },
    { id: 'engine_mtu_4000_r43l', label: 'MTU 4000 R43L — moteur diesel', category: 'Moteurs', price: 210000, match: /BB\s*75400/i, realModel: true },
    { id: 'engine_emd_12n710g3b_ec', label: 'EMD 12N-710G3B-EC — moteur diesel', category: 'Moteurs', price: 220000, match: /(Class\s*66|JT42CWR)/i, realModel: true },
    { id: 'engine_man_d2866_luh21', label: 'MAN D2866 LUH21 — moteur diesel', category: 'Moteurs', price: 65000, match: /(X\s*73(?:500|900)|ATER)/i, realModel: true },
    { id: 'engine_generic', label: 'Moteur principal / module de traction — référence série', category: 'Moteurs', price: 140000 },
    { id: 'turbocharger', label: 'Turbocompresseur moteur diesel', category: 'Moteurs', price: 22000 },
    { id: 'injector_set', label: 'Jeu d’injecteurs moteur', category: 'Moteurs', price: 8500 },
    { id: 'fuel_pump', label: 'Pompe carburant haute pression', category: 'Moteurs', price: 7200 },
    { id: 'oil_pump', label: 'Pompe à huile moteur', category: 'Moteurs', price: 4800 },
    { id: 'water_pump', label: 'Pompe circuit refroidissement', category: 'Moteurs', price: 5200 },
    { id: 'radiator_module', label: 'Module radiateur / échangeur', category: 'Moteurs', price: 12500 },
    { id: 'gearbox_module', label: 'Réducteur / transmission', category: 'Transmission', price: 42000 },
    { id: 'cardan_shaft', label: 'Arbre de transmission / cardan', category: 'Transmission', price: 7200 },
    { id: 'traction_motor', label: 'Moteur de traction', category: 'Traction', price: 38000 },
    { id: 'traction_inverter', label: 'Convertisseur / onduleur de traction', category: 'Traction', price: 52000 },
    { id: 'main_transformer', label: 'Transformateur principal', category: 'Traction', price: 95000 },
    { id: 'main_breaker', label: 'Disjoncteur principal HT', category: 'Traction', price: 18500 },
    { id: 'aux_converter', label: 'Convertisseur auxiliaire', category: 'Électrique', price: 28000 },
    { id: 'pantograph', label: 'Pantographe complet', category: 'Captage', price: 24000 },
    { id: 'pantograph_strip', label: 'Bande d’usure de pantographe', category: 'Captage', price: 950 },
    { id: 'wheelset', label: 'Essieu monté', category: 'Roulement', price: 14500 },
    { id: 'axle_bearing', label: 'Boîte d’essieu / roulement', category: 'Roulement', price: 2800 },
    { id: 'bogie_frame', label: 'Châssis de bogie', category: 'Bogies', price: 48000 },
    { id: 'air_spring', label: 'Coussin de suspension pneumatique', category: 'Bogies', price: 2400 },
    { id: 'damper', label: 'Amortisseur de suspension', category: 'Bogies', price: 950 },
    { id: 'brake_disc', label: 'Disque de frein', category: 'Freinage', price: 1200 },
    { id: 'brake_pad_set', label: 'Jeu de garnitures / semelles de frein', category: 'Freinage', price: 420 },
    { id: 'brake_caliper', label: 'Étrier / mécanisme de frein', category: 'Freinage', price: 3500 },
    { id: 'brake_cylinder', label: 'Cylindre de frein', category: 'Freinage', price: 1800 },
    { id: 'compressor', label: 'Compresseur d’air principal', category: 'Pneumatique', price: 12000 },
    { id: 'air_dryer', label: 'Sécheur d’air', category: 'Pneumatique', price: 3400 },
    { id: 'air_reservoir', label: 'Réservoir d’air principal', category: 'Pneumatique', price: 2900 },
    { id: 'hvac_unit', label: 'Groupe climatisation / HVAC', category: 'Confort', price: 18000 },
    { id: 'hvac_compressor', label: 'Compresseur de climatisation', category: 'Confort', price: 4800 },
    { id: 'door_drive', label: 'Mécanisme / motorisation de porte', category: 'Portes', price: 2600 },
    { id: 'door_leaf', label: 'Vantail / panneau de porte', category: 'Portes', price: 3400 },
    { id: 'battery_pack', label: 'Batterie auxiliaire', category: 'Électrique', price: 4200 },
    { id: 'headlight_unit', label: 'Bloc optique / fanal', category: 'Électrique', price: 850 },
    { id: 'windscreen', label: 'Pare-brise cabine', category: 'Caisse', price: 3200 },
    { id: 'wiper_motor', label: 'Moteur d’essuie-glace', category: 'Caisse', price: 650 },
    { id: 'cab_display', label: 'Écran / pupitre cabine', category: 'Électronique', price: 5800 },
    { id: 'control_card', label: 'Carte électronique de commande', category: 'Électronique', price: 2400 },
    { id: 'oil_filter', label: 'Filtre à huile', category: 'Consommables atelier', price: 85 },
    { id: 'fuel_filter', label: 'Filtre à carburant', category: 'Consommables atelier', price: 95 },
    { id: 'air_filter', label: 'Filtre à air moteur', category: 'Consommables atelier', price: 140 },
    { id: 'coolant_filter', label: 'Filtre circuit refroidissement', category: 'Consommables atelier', price: 110 },
    { id: 'toilet_pump', label: 'Pompe sanitaire / WC', category: 'Sanitaires', price: 2100 },
    { id: 'toilet_valve', label: 'Vanne / clapet sanitaire', category: 'Sanitaires', price: 780 },
    { id: 'coupler_wear_kit', label: 'Kit d’usure attelage / tampons', category: 'Attelage', price: 1800 },
    { id: 'automatic_coupler_head', label: 'Tête d’attelage automatique', category: 'Attelage', price: 14500 },
    { id: 'buffer', label: 'Tampon complet', category: 'Attelage', price: 2600 },
]);
export const DEPOT_OPERATION_CATALOG = Object.freeze({
    wc_repair: { label: 'Réparation WC', group: 'Maintenance', duration: 90, staff: { agent_assainissement: 1 }, parts: { toilet_pump: 1 }, equipment: ['toilet_service'] },
    socket_repair: { label: 'Réparation prise ou éclairage', group: 'Maintenance', duration: 60, staff: { electricien_bord: 1 }, parts: { aux_converter: 1 }, equipment: ['electrical_bench'] },
    seat_repair: { label: 'Réparation siège', group: 'Maintenance', duration: 45, staff: { agent_maintenance: 1 }, resources: { interior_cleaner_l: 1 }, equipment: ['interior_cleaning'] },
    refuel: { label: 'Plein de gazole', group: 'Avitaillement', duration: 25, staff: { agent_avitaillement: 1 }, dynamic: 'fuel', equipment: ['fuel_station'] },
    sand_fill: { label: 'Remplissage des sablières', group: 'Avitaillement', duration: 15, staff: { agent_avitaillement: 1 }, dynamic: 'sand', equipment: ['sand_station'] },
    fluid_service: { label: 'Niveaux / changement des fluides', group: 'Maintenance', duration: 60, staff: { agent_maintenance: 1 }, dynamic: 'fluids', resources: { electricity_kwh: 8, compressed_air_m3: 4 }, equipment: ['fluid_station'] },
    washer_fill: { label: 'Remplissage lave-glace', group: 'Avitaillement', duration: 10, staff: { agent_avitaillement: 1 }, dynamic: 'washer', equipment: ['fluid_station'] },
    full_refill: { label: 'Plein complet des consommables', group: 'Avitaillement', duration: 110, staff: { agent_avitaillement: 1 }, dynamic: 'full_refill', equipment: [] },
    lubrication: { label: 'Graissage / lubrification', group: 'Maintenance', duration: 45, staff: { agent_maintenance: 1 }, resources: { grease_kg: 6, penetrating_oil_l: 1, electricity_kwh: 5, compressed_air_m3: 8 }, equipment: ['inspection_pit', 'compressor_station'] },
    sanitary_service: { label: 'Vidange et service sanitaires', group: 'Nettoyage', duration: 35, staff: { agent_assainissement: 1 }, resources: { water_l: 450, toilet_chemical_l: 4, wastewater_l: 350, electricity_kwh: 4 }, equipment: ['toilet_service'] },
    exterior_wash: { label: 'Lavage extérieur', group: 'Nettoyage', duration: 35, staff: { agent_lavage: 2 }, resources: { water_l: 850, detergent_l: 4, electricity_kwh: 12 }, equipment: ['wash_plant'] },
    interior_clean: { label: 'Nettoyage intérieur', group: 'Nettoyage', duration: 55, staff: { agent_nettoyage: 2 }, resources: { water_l: 90, interior_cleaner_l: 3, electricity_kwh: 6 }, equipment: ['interior_cleaning'] },
    deep_disinfection: { label: 'Nettoyage intérieur approfondi / désinfection', group: 'Nettoyage', duration: 120, staff: { agent_nettoyage: 3 }, resources: { water_l: 160, interior_cleaner_l: 5, disinfectant_l: 5, electricity_kwh: 10 }, equipment: ['interior_cleaning'] },
    routine_service: { label: 'Visite / entretien courant', group: 'Maintenance', duration: 120, staff: { agent_visite: 1, agent_maintenance: 2 }, resources: { electricity_kwh: 35, compressed_air_m3: 20, brake_cleaner_l: 2 }, parts: { oil_filter: 1, air_filter: 1 }, equipment: ['inspection_pit', 'compressor_station'] },
    brake_pads_replace: { label: 'Remplacement ciblé des semelles / garnitures', group: 'Maintenance', duration: 90, staff: { specialiste_freinage: 1, agent_maintenance: 1 }, resources: { electricity_kwh: 20, compressed_air_m3: 20, brake_cleaner_l: 4 }, parts: { brake_pad_set: 4 }, equipment: ['inspection_pit', 'brake_bench', 'compressor_station'] },
    brake_discs_replace: { label: 'Remplacement ciblé des disques de frein', group: 'Maintenance lourde', duration: 180, staff: { specialiste_freinage: 2, agent_levage: 1 }, resources: { electricity_kwh: 50, compressed_air_m3: 30, brake_cleaner_l: 6 }, parts: { brake_disc: 2 }, equipment: ['inspection_pit', 'lifting_jacks', 'brake_bench', 'compressor_station'] },
    brake_overhaul: { label: 'Révision du freinage', group: 'Maintenance lourde', duration: 240, staff: { specialiste_freinage: 2, technicien_pneumatique: 1 }, resources: { electricity_kwh: 75, compressed_air_m3: 80, brake_cleaner_l: 8 }, parts: { brake_pad_set: 4, brake_disc: 2 }, equipment: ['inspection_pit', 'brake_bench', 'compressor_station'] },
    wheel_reprofile: { label: 'Reprofilage des essieux', group: 'Maintenance lourde', duration: 300, staff: { specialiste_essieux: 2 }, resources: { electricity_kwh: 180 }, equipment: ['underfloor_lathe'] },
    bogie_change: { label: 'Dépose / remplacement bogie', group: 'Maintenance lourde', duration: 540, staff: { agent_levage: 2, specialiste_essieux: 2 }, resources: { electricity_kwh: 260, grease_kg: 12 }, parts: { bogie_frame: 1 }, equipment: ['lifting_jacks', 'bogie_drop', 'overhead_crane'] },
    engine_replace: { label: 'Remplacement moteur diesel / module principal', group: 'Maintenance lourde', duration: 720, staff: { mecanicien_diesel: 3, agent_levage: 2 }, resources: { electricity_kwh: 420 }, dynamic: 'engine', equipment: ['lifting_jacks', 'overhead_crane'] },
    traction_motor_replace: { label: 'Remplacement moteur de traction', group: 'Maintenance lourde', duration: 480, staff: { technicien_traction_elec: 2, agent_levage: 2 }, resources: { electricity_kwh: 260 }, parts: { traction_motor: 1 }, equipment: ['lifting_jacks', 'overhead_crane', 'electrical_bench'] },
    pantograph_replace: { label: 'Remplacement pantographe', group: 'Maintenance lourde', duration: 180, staff: { technicien_traction_elec: 2 }, resources: { electricity_kwh: 35 }, parts: { pantograph: 1 }, equipment: ['roof_access', 'overhead_crane'] },
    electrical_diagnostic: { label: 'Diagnostic électrique / électronique', group: 'Maintenance', duration: 90, staff: { electromecanicien: 1, electricien_bord: 1 }, resources: { electricity_kwh: 18 }, equipment: ['electrical_bench'] },
    headlight_replace: { label: 'Remplacement des fanaux', group: 'Maintenance', duration: 60, staff: { electricien_bord: 1 }, resources: { electricity_kwh: 10 }, parts: { headlight_unit: 1 }, equipment: ['electrical_bench'] },
    compressor_replace: { label: 'Remplacement compresseur d’air', group: 'Maintenance lourde', duration: 210, staff: { technicien_pneumatique: 2, agent_maintenance: 1 }, resources: { electricity_kwh: 45, compressed_air_m3: 20 }, parts: { compressor: 1 }, equipment: ['inspection_pit', 'compressor_station'] },
    hvac_replace: { label: 'Remplacement groupe climatisation', group: 'Maintenance lourde', duration: 180, staff: { technicien_hvac: 2, agent_levage: 1 }, resources: { electricity_kwh: 40 }, parts: { hvac_unit: 1 }, equipment: ['roof_access', 'overhead_crane'] },
    door_repair: { label: 'Réparation mécanisme de porte', group: 'Maintenance', duration: 90, staff: { agent_maintenance: 1, electromecanicien: 1 }, resources: { electricity_kwh: 12 }, parts: { door_drive: 1 } },
    battery_service: { label: 'Contrôle / remplacement batteries', group: 'Maintenance', duration: 75, staff: { electricien_bord: 1 }, resources: { electricity_kwh: 20 }, parts: { battery_pack: 1 }, equipment: ['battery_station'] },
    deicing: { label: 'Dégivrage du matériel', group: 'Nettoyage', duration: 30, staff: { agent_lavage: 1 }, resources: { deicer_l: 18, water_l: 120, electricity_kwh: 15 }, equipment: ['deicing_station'] },
});
const REPAIR_COMPONENT_BY_OPERATION = Object.freeze({
    engine_replace: 'moteur', brake_overhaul: 'frein', brake_pads_replace: 'frein', brake_discs_replace: 'frein', door_repair: 'portes',
    hvac_replace: 'climatisation', traction_motor_replace: 'traction',
    pantograph_replace: 'pantographe', compressor_replace: 'compresseur',
    battery_service: 'batterie', headlight_replace: 'fanaux',
});
const REPAIR_DEFECT_BY_OPERATION = Object.freeze({
    engine_replace: 'moteur', brake_overhaul: 'freins', brake_pads_replace: 'freins', brake_discs_replace: 'freins', door_repair: 'portes',
    hvac_replace: 'climatisation', traction_motor_replace: 'traction',
    pantograph_replace: 'pantographe', compressor_replace: 'compresseur',
    battery_service: 'batterie', headlight_replace: 'fanaux',
});
const REPAIR_COMPONENT_BY_BREAKDOWN = Object.freeze({
    moteur: 'moteur', freins: 'frein', climatisation: 'climatisation',
    portes: 'portes', fanaux: 'fanaux',
});
let nextDepotOperationId = 1;
function depotFinite(v, fb = 0) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function depotClamp(v, a, b) { return Math.max(a, Math.min(b, depotFinite(v, a))); }
function materialSearchText(rame) { return [rame?.name, rame?.serialNumber, ...(rame?.elementDetails || []).flatMap((e) => [e?.name, e?.instanceName, e?.seriesName])].filter(Boolean).join(' '); }
function depotVehicleIds(rame) {
    const ids = (rame?.elementDetails || []).map(detail => String(detail.physicalVehicleId || '')).filter(Boolean);
    for (const vehicle of globalThis.window?.game?.rotationV2?.vehicles || [])
        if (vehicle.sourceRameId === rame?.id && !ids.includes(vehicle.id) &&
            (!vehicle.location || (vehicle.location.kind === 'DEPOT' && vehicle.location.id === rame.currentLocation?.depotId)))
            ids.push(vehicle.id);
    return ids;
}
function depotConsumableSources(rame) { return (rame?.elementDetails || []).map(d => d.consumables).filter(c => c && typeof c === 'object' && !Array.isArray(c)); }
function depotConsumableLevels(rame) {
    const sources = depotConsumableSources(rame);
    if (!sources.length)
        return (rame?.consumables || {});
    const total = {};
    for (const levels of sources)
        for (const [k, value] of Object.entries(levels)) {
            if (Number.isFinite(Number(value)))
                total[k] = (total[k] || 0) + Math.max(0, Number(value));
        }
    return total;
}
function refillIndividualLevels(rame, op) {
    const pairs = { refuel: [['fuelL', 'fuelCapacityL']], sand_fill: [['sandKg', 'sandCapacityKg']], washer_fill: [['washerL', 'washerCapacityL']], fluid_service: [['oilL', 'oilCapacityL'], ['coolantL', 'coolantCapacityL'], ['adblueL', 'adblueCapacityL'], ['gearboxOilL', 'gearboxOilCapacityL'], ['hydraulicOilL', 'hydraulicOilCapacityL']] };
    const selected = op.opId === 'full_refill' ? Object.values(pairs).flat() : pairs[String(op.opId)] || [];
    for (const detail of rame.elementDetails || [])
        if (!op.resourceVehicleIds || op.resourceVehicleIds.includes(String(detail.physicalVehicleId || '')))
            for (const [quantity, capacity] of selected) {
                const c = detail.consumables;
                if (c && Number(c[capacity]) > 0)
                    c[quantity] = Number(c[capacity]);
            }
}
function partForEngine(rame, targetVehicleId = '') {
    const detail = targetVehicleId ? rame?.elementDetails?.find(d => String(d.physicalVehicleId || '') === targetVehicleId) : null;
    const vehicle = targetVehicleId ? globalThis.window?.game?.rotationV2?.getVehicle?.(targetVehicleId) : null;
    const txt = detail || vehicle ? [detail?.name, detail?.instanceName, detail?.seriesName, vehicle?.number, vehicle?.series, vehicle?.name].filter(Boolean).join(' ') : materialSearchText(rame);
    return DEPOT_PART_CATALOG.find((p) => p.realModel && p.match?.test(txt)) || DEPOT_PART_CATALOG.find((p) => p.id === 'engine_generic');
}
export class Depot {
    constructor(data = {}) {
        this._stockFinanceHoldResolver = null;
        this.creationPackVersion = 0;
        this.creationStaffProvisioned = false;
        this.creationStaffIds = [];
        const src = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        this.id = src.id == null || src.id === '' ? `depot-${nextDepotId++}` : String(src.id);
        const explicitSequence = /^depot-(\d+)$/.exec(this.id);
        if (explicitSequence)
            nextDepotId = Math.max(nextDepotId, Number(explicitSequence[1]) + 1);
        this.creationPackVersion = src.creationPackVersion === 1 ? 1 : 0;
        this.creationStaffProvisioned = src.creationStaffProvisioned === true;
        this.creationStaffIds = Array.isArray(src.creationStaffIds) ? [...new Set(src.creationStaffIds.filter((id) => typeof id === 'string' && !!id))] : [];
        this.type = (src.type || 'depot'); // depot, ite-fret, ite-industrie, ite-logistique
        this.name = (src.name || 'Depot');
        this.stationId = String(src.stationId ?? '');
        this.stationUpgradeSource = typeof src.stationUpgradeSource === 'string' ? src.stationUpgradeSource : '';
        this.stationUpgradeTracks = Math.max(0, Math.min(3, Math.floor(depotFinite(src.stationUpgradeTracks, 0))));
        const tracks = Math.floor(Number(src.tracks));
        this.tracks = Number.isFinite(tracks) && tracks > 0 ? tracks : 4;
        const cost = Number(src.cost);
        this.cost = Number.isFinite(cost) && cost >= 0 ? cost : 50000;
        this.built = src.built === true;
        // DEP-01 : infrastructures dépôt (remisage, rotonde, technicentre)
        const infraAllowed = new Set(['remisage', 'rotonde', 'technicentre']);
        this.infrastructure = [...new Set((Array.isArray(src.infrastructure) ? src.infrastructure : []).filter((x) => typeof x === 'string' && infraAllowed.has(x)))];
        // HOTFIX51 — physical workshop equipment. Counts are capacities: one tour en
        // fosse cannot serve two trains at the same time. Legacy technicentre/rotonde
        // flags are migrated once so old depots keep useful capabilities.
        this.equipmentInventory = {};
        if (src.equipmentInventory && typeof src.equipmentInventory === 'object' && !Array.isArray(src.equipmentInventory)) {
            for (const [key, value] of Object.entries(src.equipmentInventory)) {
                const def = DEPOT_EQUIPMENT_CATALOG[key], n = Math.floor(Number(value));
                if (def && Number.isFinite(n) && n > 0)
                    this.equipmentInventory[key] = Math.min(this.creationPackVersion ? Math.max(DEPOT_CREATION_MACHINE_COUNT, def.maxCount || 1) : def.maxCount || 1, n);
            }
        }
        if (!this.creationPackVersion && !Object.keys(this.equipmentInventory).length) {
            if (this.infrastructure.includes('technicentre'))
                Object.assign(this.equipmentInventory, { inspection_pit: 1, lifting_jacks: 1, overhead_crane: 1, underfloor_lathe: 1, brake_bench: 1, electrical_bench: 1, compressor_station: 1, fuel_station: 1, sand_station: 1, fluid_station: 1, wash_plant: 1, interior_cleaning: 1, roof_access: 1, battery_station: 1 });
            if (this.infrastructure.includes('remisage'))
                this.equipmentInventory.interior_cleaning = Math.max(1, this.equipmentInventory.interior_cleaning || 0);
        }
        this.ramesStored = [...new Set((Array.isArray(src.ramesStored) ? src.ramesStored : []).filter((x) => typeof x === 'string' && x))];
        // HOTFIX40 — V2 infrastructure geometry. Each section is an independent
        // Schedule-Creator-grade A→B route; no continuity is implied between sections.
        this.schemaVersion = Number(src.schemaVersion) >= 2 ? 2 : 1;
        this.location = src.location && Number.isFinite(Number(src.location.lat)) && Number.isFinite(Number(src.location.lon))
            ? { lat: Number(src.location.lat), lon: Number(src.location.lon) } : null;
        // HOTFIX49 — point objects created from the Depots & ITE page do not carry
        // artificial ORM sections. stationId remains a technical gameplay link only.
        this.placementOnly = src.placementOnly === true;
        this.railSections = (Array.isArray(src.railSections) ? src.railSections : [])
            .map((x, i) => normalizeRailSection(x, { id: `${this.id}-section-${i + 1}`, name: `Section ${i + 1}`, direction: 'both' }))
            .filter((x) => x.route.length >= 2 && x.startBinding && x.endBinding);
        // ITE track footprints keep their real ORM geometry when available, while
        // preserving legacy {name,length,cargoType} saves.
        this.iteTracks = (Array.isArray(src.iteTracks) ? src.iteTracks : []).filter((t) => t && typeof t === 'object' && Number.isFinite(Number(t.length)) && Number(t.length) > 0).map((t, i) => ({
            name: String(t.name || 'Voie').trim() || 'Voie', length: Math.max(1, Number(t.length)), cargoType: typeof t.cargoType === 'string' ? t.cargoType : '',
            startBinding: cleanRailBinding(t.startBinding), endBinding: cleanRailBinding(t.endBinding), constraints: Array.isArray(t.constraints) ? cloneRailValue(t.constraints) : [],
            route: cleanRailRoute(t.route), segments: Array.isArray(t.segments) ? cloneRailValue(t.segments) : [], distanceKm: Number.isFinite(Number(t.distanceKm)) ? Math.max(0, Number(t.distanceKm)) : Math.max(0, Number(t.length) / 1000), role: String(t.role || 'ite-track')
        }));
        // V2 ITEs can reconstruct the common section collection from track geometry.
        if (!this.railSections.length) {
            this.railSections = this.iteTracks.filter((t) => t.route?.length >= 2 && t.startBinding && t.endBinding).map((t, i) => normalizeRailSection({ ...t, id: `${this.id}-section-${i + 1}`, name: t.name, role: 'ite-track', direction: 'both' }));
        }
        this.iteCargoTypes = [...new Set((Array.isArray(src.iteCargoTypes) ? src.iteCargoTypes : []).filter((x) => typeof x === 'string' && x))];
        // Rescue locomotives: array of { stockId, stockName, deployed }
        this.rescueLocos = (Array.isArray(src.rescueLocos) ? src.rescueLocos : []).filter((r) => r && r.stockId).map((r) => ({
            stockId: String(r.stockId),
            stockName: String(r.stockName || '').slice(0, 160),
            traction: String(r.traction || '').slice(0, 80),
            deployed: r.deployed === true,
            totalKmRun: typeof r.totalKmRun === 'number' && Number.isFinite(r.totalKmRun) ? Math.max(0, r.totalKmRun) : 0,
            consumables: r.consumables && typeof r.consumables === 'object' && !Array.isArray(r.consumables)
                ? Object.fromEntries(Object.entries(r.consumables).filter(([k, n]) => !['__proto__', 'constructor', 'prototype'].includes(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0)) : undefined,
        }));
        // HOTFIX50 — real depot stocks + operating costs. Legacy spareParts are
        // migrated into the richer part inventory instead of being discarded.
        this.partInventory = {};
        if (src.partInventory && typeof src.partInventory === 'object' && !Array.isArray(src.partInventory)) {
            for (const [key, value] of Object.entries(src.partInventory)) {
                const n = Math.floor(Number(value));
                if (key && Number.isFinite(n) && n >= 0)
                    this.partInventory[String(key)] = n;
            }
        }
        const legacyMap = { moteur: 'engine_generic', climatisation: 'hvac_unit', fanaux: 'headlight_unit', freins: 'brake_pad_set', portes: 'door_drive' };
        if (src.spareParts && typeof src.spareParts === 'object' && !Array.isArray(src.spareParts)) {
            // Modern saves contain both the canonical stock and its legacy view. Do
            // not restock spare parts merely because the player resumed a game.
            for (const [oldKey, newKey] of Object.entries(legacyMap)) {
                if (src.partInventory && Object.prototype.hasOwnProperty.call(src.partInventory, newKey))
                    continue;
                const n = Math.floor(Number(src.spareParts[oldKey]));
                if (Number.isFinite(n) && n > 0)
                    this.partInventory[newKey] = (this.partInventory[newKey] || 0) + n;
            }
        }
        // Keep a legacy read-only shaped view for old code/tests.
        this.spareParts = { moteur: this.partInventory.engine_generic || 0, climatisation: this.partInventory.hvac_unit || 0, fanaux: this.partInventory.headlight_unit || 0, freins: this.partInventory.brake_pad_set || 0, portes: this.partInventory.door_drive || 0 };
        this.resourceStocks = {};
        this.resourceCapacities = {};
        this.resourceUsage = {};
        for (const [key, def] of Object.entries(DEPOT_RESOURCE_CATALOG)) {
            this.resourceUsage[key] = Math.max(0, depotFinite(src.resourceUsage?.[key], 0));
            if (!def.stock)
                continue;
            const cap = Math.max(0, depotFinite(src.resourceCapacities?.[key], def.defaultCapacity));
            this.resourceCapacities[key] = cap;
            this.resourceStocks[key] = depotClamp(src.resourceStocks?.[key], 0, cap);
        }
        this.trackDefinitions = Array.from({ length: this.tracks }, (_, i) => { const raw = Array.isArray(src.trackDefinitions) ? src.trackDefinitions[i] || {} : {}; return { id: String(raw.id || `${this.id}:track:${i + 1}`), lengthM: Math.max(0, depotFinite(raw.lengthM)), access: raw.access === 'single' ? 'single' : 'through', electrification: typeof raw.electrification === 'boolean' ? raw.electrification : null }; });
        this.vehiclePositions = Array.isArray(src.vehiclePositions) ? src.vehiclePositions.filter(p => p && typeof p.vehicleId === 'string' && Number.isFinite(p.startM) && Number.isFinite(p.endM) && p.endM >= p.startM).map(p => ({ ...p })) : [];
        const slots = Array.isArray(src.trackOccupancy) ? src.trackOccupancy : [];
        this.trackOccupancy = Array.from({ length: this.tracks }, (_, i) => { const raw = slots[i] || {}; return { track: i + 1, rameId: String(raw.rameId || ''), purpose: String(raw.purpose || 'garage'), operationId: String(raw.operationId || '') }; });
        // RC48 extensions saved occupancy without physical track definitions. The
        // occupied slot is the authoritative index; preserve every vehicle/offset.
        const trackIds = new Set(this.trackDefinitions.map(track => track.id));
        for (const position of this.vehiclePositions) {
            if (trackIds.has(position.trackId))
                continue;
            const slot = position.rameId && this.trackOccupancy.find(track => track.rameId === position.rameId);
            const definition = slot && this.trackDefinitions[slot.track - 1];
            if (definition)
                position.trackId = definition.id;
        }
        this.utilityTotals = { electricityKWh: Math.max(0, depotFinite(src.utilityTotals?.electricityKWh, 0)), waterL: Math.max(0, depotFinite(src.utilityTotals?.waterL, 0)), expenseEur: Math.max(0, depotFinite(src.utilityTotals?.expenseEur, 0)) };
        this.expenseLedger = (Array.isArray(src.expenseLedger) ? src.expenseLedger : []).filter((x) => x && typeof x === 'object').slice(-120).map((x) => ({ time: Number(x.time) || 0, label: String(x.label || ''), amount: Math.max(0, depotFinite(x.amount, 0)), category: String(x.category || 'exploitation') }));
    }
    _syncLegacySpareParts() {
        this.spareParts = { moteur: this.partInventory.engine_generic || 0, climatisation: this.partInventory.hvac_unit || 0, fanaux: this.partInventory.headlight_unit || 0, freins: this.partInventory.brake_pad_set || 0, portes: this.partInventory.door_drive || 0 };
    }
    initializeCreationPack() {
        if (this.type !== 'depot' || this.creationPackVersion)
            return false;
        for (const key of Object.keys(DEPOT_EQUIPMENT_CATALOG))
            this.equipmentInventory[key] = DEPOT_CREATION_MACHINE_COUNT;
        for (const part of DEPOT_PART_CATALOG)
            this.partInventory[part.id] = Math.max(DEPOT_CREATION_PART_COUNT, this.partInventory[part.id] || 0);
        for (const [key, def] of Object.entries(DEPOT_RESOURCE_CATALOG))
            if (def.stock)
                this.resourceStocks[key] = this.resourceCapacities[key];
        this._syncLegacySpareParts();
        this.creationPackVersion = 1;
        return true;
    }
    appendTracks(count) {
        const ids = new Set(this.trackDefinitions.map(track => track.id)), old = this.tracks;
        for (let i = 0; i < count; i++) {
            const index = old + i + 1, base = `${this.id}:track:${index}`;
            let id = base, suffix = 2;
            while (ids.has(id))
                id = `${base}:${suffix++}`;
            ids.add(id);
            this.trackDefinitions.push({ id, lengthM: 0, access: 'through', electrification: null });
            this.trackOccupancy.push({ track: index, rameId: '', purpose: 'garage', operationId: '' });
        }
        this.tracks += count;
    }
    addPart(partId, qty) {
        const key = String(partId || '');
        const amount = Math.floor(Number(qty));
        if (!key || !Number.isFinite(amount) || amount <= 0)
            return false;
        this.partInventory[key] = (Number(this.partInventory[key]) || 0) + amount;
        this._syncLegacySpareParts();
        return true;
    }
    connectStockFinanceHoldResolver(resolver) { this._stockFinanceHoldResolver = resolver; }
    availablePartStock(referenceId) { return this._availableFinancedStock(referenceId, 'part'); }
    availableResourceStock(referenceId) { return this._availableFinancedStock(referenceId, 'resource'); }
    _availableFinancedStock(referenceId, kind) {
        const physical = Math.max(0, Number((kind === 'part' ? this.partInventory : this.resourceStocks)[referenceId]) || 0);
        if (!depotBudgetRequired())
            return physical;
        const held = Math.max(0, Number(this._stockFinanceHoldResolver?.(referenceId, kind)) || 0);
        return Math.max(0, physical - held);
    }
    consumeParts(parts) {
        const entries = Object.entries(parts || {}).map(([k, v]) => [String(k), Math.floor(Number(v))]);
        if (!entries.length)
            return true;
        for (const [k, n] of entries) {
            if (!k || !Number.isFinite(n) || n <= 0 || this.availablePartStock(k) < n)
                return false;
        }
        for (const [k, n] of entries)
            this.partInventory[k] -= n;
        this._syncLegacySpareParts();
        return true;
    }
    // Legacy API retained for old repair/rescue paths.
    addSpareParts(type, qty) { const map = { moteur: 'engine_generic', climatisation: 'hvac_unit', fanaux: 'headlight_unit', freins: 'brake_pad_set', portes: 'door_drive' }; const key = String(type || ''); return this.addPart(map[key] || key, qty); }
    consumeSpareParts(parts) { const map = { moteur: 'engine_generic', climatisation: 'hvac_unit', fanaux: 'headlight_unit', freins: 'brake_pad_set', portes: 'door_drive' }; const next = {}; for (const [k, v] of Object.entries(parts || {}))
        next[map[k] || k] = v; return this.consumeParts(next); }
    freeTrackCount() { return this.trackOccupancy.filter((x) => !x.rameId).length; }
    occupancyCount() { return this.trackOccupancy.filter((x) => !!x.rameId).length; }
    findRameTrack(rameId) { return this.trackOccupancy.find((x) => x.rameId === String(rameId || '')) || null; }
    getTypeLabel() {
        const labels = {
            'depot': 'Depot maintenance',
            'ite-fret': 'ITE Fret',
            'ite-industrie': 'ITE Industrie',
            'ite-logistique': 'ITE Logistique',
        };
        return labels[this.type] || this.type;
    }
    getMaintenanceCost() {
        return this.tracks * 200;
    }
    hasInfrastructure(type) {
        return Array.isArray(this.infrastructure) && this.infrastructure.includes(type);
    }
    equipmentCount(id) { const key = String(id || ''); return Math.max(0, Math.floor(Number(this.equipmentInventory?.[key]) || 0)); }
    hasEquipment(id) { return this.equipmentCount(id) > 0; }
    addEquipment(id, count = 1) { const key = String(id || ''); const def = DEPOT_EQUIPMENT_CATALOG[key], n = Math.floor(Number(count)); if (!def || !Number.isFinite(n) || n <= 0)
        return false; const cur = this.equipmentCount(id), next = Math.min(def.maxCount || 1, cur + n); if (next <= cur)
        return false; this.equipmentInventory[key] = next; return true; }
    // HOTFIX51 — les équipements précis gouvernent désormais la faisabilité.
    // L'ancien drapeau générique "technicentre" ne pénalise plus toutes les opérations.
    getMaintenanceDuration(baseMinutes) {
        const base = Math.max(1, Number(baseMinutes) || 60);
        if (this.hasInfrastructure('rotonde'))
            return Math.max(5, Math.round(base * 0.8));
        return base;
    }
    // Can dispatch rescue locomotive (has available non-deployed locos)
    canRescue() {
        return this.type === 'depot' && this.built && this.rescueLocos.some((r) => !r.deployed);
    }
    // Get first available rescue loco
    getAvailableRescueLoco(preferredTraction) {
        const preferred = String(preferredTraction || '').toLowerCase();
        if (preferred) {
            const match = this.rescueLocos.find((r) => !r.deployed && r.traction && r.traction.toLowerCase().includes(preferred));
            if (match)
                return match;
        }
        return this.rescueLocos.find((r) => !r.deployed);
    }
    // Mark a rescue loco as deployed
    deployRescue(stockId) {
        const loco = this.rescueLocos.find((r) => r.stockId === stockId && !r.deployed);
        if (loco) {
            loco.deployed = true;
            return loco;
        }
        return null;
    }
    // Return a rescue loco to depot
    returnRescue(stockId) {
        const loco = this.rescueLocos.find((r) => r.stockId === stockId && r.deployed);
        if (loco)
            loco.deployed = false;
    }
}
export class DepotManager {
    connectCreationStaffManager(staff) {
        this._creationStaffManager = staff;
        for (const depot of this._pendingCreationStaff)
            this._provisionCreationStaff(depot);
    }
    _provisionCreationStaff(depot) {
        if (!this._creationStaffManager || depot.creationStaffProvisioned)
            return;
        // The staff belong to the paid construction bundle; hiring must not post a
        // second player debit. They retain the ordinary staffing/payroll lifecycle.
        const funding = { balance: Number.MAX_SAFE_INTEGER, addExpense: () => true };
        for (const role of Object.keys(DEPOT_STAFF_CATALOG)) {
            const hired = this._creationStaffManager.hire(funding, '', role, { count: DEPOT_CREATION_STAFF_PER_ROLE, assignedTo: depot.id, generateEach: true });
            if (hired)
                depot.creationStaffIds.push(...hired.map(agent => agent.id));
        }
        depot.creationStaffProvisioned = true;
        this._pendingCreationStaff.delete(depot);
    }
    registerCreatedDepot(depot) {
        if (this.getDepotById(depot.id))
            return null;
        depot.built = true;
        if (depot.initializeCreationPack()) {
            this._pendingCreationStaff.add(depot);
            this._provisionCreationStaff(depot);
        }
        this._connectDepotStockFinance(depot);
        this.depots.push(depot);
        return depot;
    }
    connectStockFinanceHoldResolver(resolver) {
        this._stockFinanceHoldResolver = resolver;
        this._stockFinanceConnected = new WeakSet();
        for (const depot of this.depots)
            this._connectDepotStockFinance(depot);
    }
    _connectDepotStockFinance(depot) {
        if (this._stockFinanceConnected.has(depot))
            return;
        depot.connectStockFinanceHoldResolver(this._stockFinanceHoldResolver ? (referenceId, kind) => this._stockFinanceHoldResolver(depot.id, referenceId, kind) : null);
        this._stockFinanceConnected.add(depot);
    }
    constructor() {
        this._creationStaffManager = null;
        this._pendingCreationStaff = new Set();
        this._stockFinanceHoldResolver = null;
        this._stockFinanceConnected = new WeakSet();
        this._depotMovements = new Map();
        this._depotMovementClocks = new WeakMap();
        this.physicalOperations = [];
        this.vehicleUsage = new Map();
        this.nextPhysicalOperationId = 1;
        this._rescueMovements = new Map();
        this.rescuedOccurrenceIds = new Set();
        this.rescuedFormations = [];
        this.depots = [];
        this.activeRescues = []; // { id, depotId, stockId, stockName, targetServiceId, state, position }
        this.repairQueue = []; // legacy emergency repair path
        this.maintenanceQueue = []; // legacy preventive-maintenance path
        this.supplyOrders = []; // purchased depot stocks await their game-time delivery
        this.depotOperations = []; // HOTFIX50 player-launched depot operations only
    }
    add(data, economy) {
        const depot = new Depot(data);
        if (this.getDepotById(depot.id))
            return null;
        const cost = Number(depot.cost);
        if (!Number.isFinite(cost) || cost < 0)
            return null;
        depot.cost = cost;
        // There is no deferred-construction workflow in the UI. Keeping an unbuilt
        // object after a failed purchase created ghost depots/ITEs that some gameplay
        // systems still treated as operational. A purchase is therefore atomic.
        if (economy) {
            if (!Number.isFinite(Number(economy.balance)) || (depotBudgetRequired() && economy.balance < cost))
                return null;
            if (cost > 0 && economy.addExpense(cost, 'construction', `Construction ${depot.name}`) !== true)
                return null;
        }
        return this.registerCreatedDepot(depot);
    }
    remove(id) {
        id = String(id ?? '');
        if (this.getDepotById(id)?.stationUpgradeSource)
            return false; // paid module still owns these slots
        if (this.activeRescues.some((r) => r.depotId === id) || this.repairQueue.some((r) => r.depotId === id) || this.maintenanceQueue.some((r) => r.depotId === id) || this.supplyOrders.some(o => o.depotId === id) || this.depotOperations.some((r) => r.depotId === id) || this.getDepotById(id)?.trackOccupancy?.some((x) => x.rameId))
            return false;
        const before = this.depots.length;
        this.depots = this.depots.filter((d) => d.id !== id);
        return this.depots.length !== before;
    }
    getAll() {
        return this.depots;
    }
    getDepots() {
        return this.depots.filter((d) => d.type === 'depot' && d.built);
    }
    getDepotById(id) {
        id = String(id ?? '');
        const depot = this.depots.find((d) => d.id === id) || null;
        if (depot)
            this._connectDepotStockFinance(depot);
        return depot;
    }
    getITEs() {
        return this.depots.filter((d) => d.built && typeof d.type === 'string' && d.type.startsWith('ite'));
    }
    getByStation(stationId) {
        stationId = String(stationId ?? '');
        return this.depots.filter((d) => d.stationId === stationId);
    }
    addITETrack(depotId, track) {
        const depot = this.depots.find((d) => d.id === depotId);
        const length = Number(track?.length);
        const name = String(track?.name || '').trim();
        if (depot?.built && depot.type.startsWith('ite') && name && Number.isFinite(length) && length > 0) {
            const rec = { name, length, cargoType: String(track?.cargoType || ''), startBinding: cleanRailBinding(track?.startBinding), endBinding: cleanRailBinding(track?.endBinding), constraints: Array.isArray(track?.constraints) ? cloneRailValue(track.constraints) : [], route: cleanRailRoute(track?.route), segments: Array.isArray(track?.segments) ? cloneRailValue(track.segments) : [], distanceKm: Number.isFinite(Number(track?.distanceKm)) ? Math.max(0, Number(track.distanceKm)) : length / 1000, role: String(track?.role || 'ite-track') };
            depot.iteTracks.push(rec);
            if (rec.route.length >= 2 && rec.startBinding && rec.endBinding)
                depot.railSections.push(normalizeRailSection({ ...rec, id: `${depot.id}-section-${depot.railSections.length + 1}`, direction: 'both' }));
            return true;
        }
        return false;
    }
    removeITETrack(depotId, index) {
        const depot = this.depots.find((d) => d.id === depotId);
        const i = Number(index);
        if (depot?.built && depot.type.startsWith('ite') && Number.isInteger(i) && i >= 0 && i < depot.iteTracks.length) {
            depot.iteTracks.splice(i, 1);
            return true;
        }
        return false;
    }
    getTotalITELength(depotId) {
        const depot = this.depots.find((d) => d.id === depotId);
        return depot ? depot.iteTracks.reduce((s, t) => s + (Number(t.length) || 0), 0) : 0;
    }
    // Section VI — ITE : récupère le dépôt ITE lié à une gare (s'il existe)
    getITEByStation(stationId) {
        stationId = String(stationId ?? '');
        return this.depots.find((d) => d.built && typeof d.type === 'string' && d.type.startsWith('ite') && d.stationId === stationId) || null;
    }
    // Section VI — longueur utile totale d'un ITE, et nombre de tranches nécessaires
    getITEInfo(stationId, trainLengthM, cargoType) {
        const ite = this.getITEByStation(stationId);
        if (!ite)
            return { isITE: false, depotId: '', totalLength: Infinity, trancheCount: 1 };
        const totalLength = ite.iteTracks.reduce((s, t) => s + (Number(t.length) || 0), 0);
        // Vérification du type de fret accepté par l'ITE
        let cargoMatch = true;
        if (cargoType != null && String(cargoType).trim() && ite.iteCargoTypes && ite.iteCargoTypes.length > 0) {
            const cargo = String(cargoType).trim();
            cargoMatch = ite.iteCargoTypes.some((ct) => { const accepted = String(ct || '').trim(); return accepted && (accepted === cargo || cargo.startsWith(accepted) || accepted.startsWith(cargo)); });
        }
        if (totalLength <= 0) {
            // HOTFIX49 — a page-created ITE is a map object, not a hand-drawn siding.
            // With no authored useful-length geometry, do not make freight unusable:
            // length capacity is unspecified rather than zero.
            if (ite.placementOnly)
                return { isITE: true, depotId: ite.id, totalLength: Infinity, canFit: true, usable: true, trancheCount: 1, cargoMatch, placementOnly: true };
            return { isITE: true, depotId: ite.id, totalLength: 0, canFit: false, usable: false, trancheCount: 1, cargoMatch };
        }
        const rawLength = Number(trainLengthM);
        const safeLength = Number.isFinite(rawLength) ? Math.max(0, rawLength) : 0;
        const trancheCount = Math.max(1, Math.ceil(safeLength / totalLength));
        return { isITE: true, depotId: ite.id, totalLength, usable: true, canFit: safeLength <= totalLength, trancheCount, cargoMatch };
    }
    // HOTFIX50 — home assignment is not physical movement.
    assignRameHome(rame, depotId, { assignElements = true } = {}) {
        const depot = this.getDepotById(depotId);
        if (!rame || !depot || depot.type !== 'depot' || !depot.built)
            return false;
        rame.depotId = depot.id;
        if (assignElements)
            for (const el of rame.elementDetails || [])
                el.homeDepotId = depot.id;
        return true;
    }
    assignElementHome(rame, elementId, depotId) {
        const depot = this.getDepotById(depotId);
        const el = rame?.elementDetails?.find((e) => e.elementId === String(elementId || ''));
        if (!el || !depot || depot.type !== 'depot' || !depot.built)
            return false;
        el.homeDepotId = depot.id;
        return true;
    }
    clearRameHome(rame) { if (!rame)
        return false; const old = rame.depotId; rame.depotId = ''; for (const el of rame.elementDetails || [])
        if (el.homeDepotId === old)
            el.homeDepotId = ''; return true; }
    _rameHasActiveService(rame, services = []) {
        const ids = this._depotRameVehicleIds(rame);
        return services.some(svc => serviceUsesRame(svc, rame.id, ids));
    }
    _depotRameVehicles(rame, context = {}) {
        const registry = (context.rotationV2 || context.game?.rotationV2 || globalThis.window?.game?.rotationV2);
        const vehicles = new Set(registry?.getRameVehicles?.(rame.id) || []);
        for (let i = 0; i < rame.elementDetails.length; i++) {
            const projected = registry?.getRameElementVehicle?.(rame.id, i);
            if (projected)
                vehicles.add(projected);
            const id = String(rame.elementDetails[i].physicalVehicleId || '');
            if (id) {
                const physical = this._depotMovementVehicle(id, rame, context);
                if (physical)
                    vehicles.add(physical);
            }
        }
        return [...vehicles];
    }
    _depotRameVehicleIds(rame, context = {}) {
        return new Set([...rame.elementDetails.map(detail => String(detail.physicalVehicleId || '')),
            ...this._depotRameVehicles(rame, context).map(vehicle => String(vehicle.id || ''))].filter(Boolean));
    }
    enterRame(depotId, rame, services = [], reservation = {}) {
        const depot = this.getDepotById(depotId);
        if (!depot || depot.type !== 'depot' || !depot.built || !rame)
            return { ok: false, reason: 'Dépôt invalide' };
        if (this._rameHasActiveService(rame, services))
            return { ok: false, reason: 'Cette rame est encore engagée dans un service.' };
        if (rame.depotOperationId)
            return { ok: false, reason: 'Une opération dépôt est déjà en cours.' };
        if (this.physicalOperations.some(op => op.rameId === rame.id && op.state !== 'done' && op.id !== reservation.operationId) ||
            this._depotRameVehicles(rame).some(vehicle => vehicle._shuntingOwnerId || vehicle._v2OperationOwnerServiceId || vehicle._depotMovementOwnerId && vehicle._depotMovementOwnerId !== reservation.operationId))
            return { ok: false, reason: 'Cette rame est engagée dans un acheminement ou une manœuvre.' };
        const location = rame.currentLocation || {};
        if (this.isRameInMaintenance(rame.id) || this.repairQueue.some(q => q.rameId === rame.id) || this.depotOperations.some(op => op.rameId === rame.id && op.state === 'running'))
            return { ok: false, reason: 'Réparation ou entretien en cours : déplacement impossible.' };
        const physical = globalThis.window?.game?.resolveRealismPolicy?.('depots')?.enforce ?? (globalThis.window?.game?.realismSettings?.difficulty !== 'easy');
        if (physical && ((location.depotId && location.depotId !== depot.id) || (location.stationId && depot.stationId && location.stationId !== depot.stationId)))
            return { ok: false, code: 'REMOTE_MATERIAL', reason: 'Matériel distant : programmer un acheminement physique vers ce dépôt.' };
        const existing = depot.findRameTrack(rame.id);
        const slot = existing || depot.trackOccupancy.find(x => !x.rameId && (!x.operationId || x.operationId === reservation.operationId) && (reservation.track === undefined || x.track === reservation.track) && (!depot.trackDefinitions[x.track - 1]?.lengthM || depot.trackDefinitions[x.track - 1].lengthM >= Number(rame.totalLength || 0)));
        if (!slot)
            return { ok: false, reason: 'Aucune voie de garage libre de longueur compatible.' };
        const registry = globalThis.window?.game?.rotationV2;
        const members = (rame.elementDetails || []).map((detail, index) => ({ vehicleId: String(detail.physicalVehicleId || registry?.getRameElementVehicle?.(rame.id, index)?.id || ''), lengthM: Math.max(0, depotFinite(detail.length)) })).filter(member => member.vehicleId);
        if (members.some(member => this.depots.some(d => d.vehiclePositions.some(p => p.vehicleId === member.vehicleId && p.rameId !== rame.id))))
            return { ok: false, reason: 'Véhicule déjà occupé par une autre formation du dépôt.' };
        const origin = this.getDepotById(location.depotId) || this.getDepots().find(d => d.findRameTrack(rame.id));
        if (origin && origin.id !== depot.id) {
            if (rame.inMaintenance)
                return { ok: false, reason: 'Rame en maintenance : déplacement impossible.' };
            const released = this.leaveRame(origin.id, rame, services);
            if (!released.ok)
                return released;
        }
        // Commit only after validating the destination. Failed admission keeps every
        // old occupancy, location and service flag exactly as it was.
        for (const d of this.getDepots()) {
            for (const occupied of d.trackOccupancy) {
                if (occupied !== slot && occupied.rameId === rame.id) {
                    occupied.rameId = '';
                    occupied.purpose = 'garage';
                    occupied.operationId = '';
                }
            }
        }
        for (const d of this.depots)
            d.vehiclePositions = d.vehiclePositions.filter(p => p.rameId !== rame.id);
        let offset = 0;
        for (const member of members) {
            depot.vehiclePositions.push({ vehicleId: member.vehicleId, rameId: rame.id, trackId: depot.trackDefinitions[slot.track - 1]?.id || '', startM: offset, endM: offset + member.lengthM });
            offset += member.lengthM;
        }
        slot.rameId = rame.id;
        slot.purpose = 'garage';
        slot.operationId = '';
        rame.currentLocation = { depotId: depot.id, stationId: '', serviceId: '', lat: depot.location?.lat ?? null, lon: depot.location?.lon ?? null };
        retirePreparedRameServices(rame.id, this._depotRameVehicleIds(rame), services, globalThis.window?.game?.scheduleV2Runtime);
        for (const vehicle of this._depotRameVehicles(rame))
            vehicle.location = { kind: 'DEPOT', id: depot.id, lat: rame.currentLocation.lat, lon: rame.currentLocation.lon };
        // Block every future/waiting service using this rame until the player releases it,
        // without mislabelling ordinary depot storage as maintenance.
        for (const svc of services || [])
            if (serviceReferencesRame(svc, rame.id, this._depotRameVehicleIds(rame)) && svc.train) {
                svc.train.inDepot = true;
                svc.train.inMaintenance = !!rame.inMaintenance;
            }
        return { ok: true, track: slot.track, already: !!existing };
    }
    leaveRame(depotId, rame, services = []) {
        const depot = this.getDepotById(depotId);
        if (!depot || !rame)
            return { ok: false, reason: 'Dépôt / rame invalide' };
        if (rame.depotOperationId || this.depotOperations.some((o) => o.rameId === rame.id && o.state === 'running'))
            return { ok: false, reason: 'Opération en cours : sortie impossible.' };
        if (this.isRameInMaintenance(rame.id) || this.repairQueue.some(q => q.rameId === rame.id))
            return { ok: false, reason: 'Réparation ou entretien en cours : sortie impossible.' };
        const slot = depot.findRameTrack(rame.id);
        if (!slot && rame.currentLocation?.depotId !== depot.id)
            return { ok: false, reason: 'Cette rame ne se trouve pas dans ce dépôt.' };
        const positions = depot.vehiclePositions.filter(p => p.rameId === rame.id);
        const definition = positions.length ? depot.trackDefinitions.find(t => t.id === positions[0].trackId) : null;
        if (definition?.access === 'single' && positions.some(p => depot.vehiclePositions.some(other => other.rameId !== rame.id && other.trackId === p.trackId && other.startM < p.startM)))
            return { ok: false, reason: 'Matériel coincé derrière une autre formation : manœuvre de dégagement requise.' };
        depot.vehiclePositions = depot.vehiclePositions.filter(p => p.rameId !== rame.id);
        if (slot) {
            slot.rameId = '';
            slot.purpose = 'garage';
            slot.operationId = '';
        }
        if (rame.currentLocation?.depotId === depot.id)
            rame.currentLocation = { depotId: '', stationId: depot.stationId || '', serviceId: '', lat: depot.location?.lat ?? null, lon: depot.location?.lon ?? null };
        for (const vehicle of this._depotRameVehicles(rame))
            vehicle.location = { kind: depot.stationId ? 'STATION' : 'UNKNOWN', id: depot.stationId || '', lat: depot.location?.lat ?? null, lon: depot.location?.lon ?? null };
        for (const svc of services || [])
            if (serviceReferencesRame(svc, rame.id, this._depotRameVehicleIds(rame)) && svc.train) {
                svc.train.inDepot = false;
                svc.train.inMaintenance = !!rame.inMaintenance;
            }
        return { ok: true };
    }
    configureTrack(depotId, { trackId, lengthM, access, electrification } = {}) {
        const depot = this.getDepotById(depotId), track = depot?.trackDefinitions.find(t => t.id === trackId);
        if (!depot || !track)
            return { ok: false, reason: 'Voie inconnue.' };
        const length = Number(lengthM);
        if (!Number.isFinite(length) || length <= 0)
            return { ok: false, reason: 'Longueur utile positive requise.' };
        if (depot.vehiclePositions.some(p => p.trackId === trackId && p.endM > length))
            return { ok: false, reason: 'Matériel présent au-delà de la longueur proposée.' };
        track.lengthM = length;
        if (['single', 'through'].includes(access || ''))
            track.access = access;
        if (typeof electrification === 'boolean')
            track.electrification = electrification;
        return { ok: true, track: { ...track } };
    }
    getDepotVehiclePositions(depotId) { return (this.getDepotById(depotId)?.vehiclePositions || []).map(p => ({ ...p })); }
    _depotMovementVehicle(vehicleId, rame, context = {}) {
        if (!vehicleId)
            return null;
        const registry = (context.rotationV2 || context.game?.rotationV2 || globalThis.window?.game?.rotationV2);
        const index = rame?.elementDetails.findIndex(detail => String(detail.physicalVehicleId || '') === String(vehicleId)) ?? -1;
        // Inventory and V2 IDs are different namespaces. Resolve the existing
        // projection through its source element without changing the owned ID.
        return (index >= 0 ? registry?.getRameElementVehicle?.(String(rame.id), index) : null) || registry?.getVehicle?.(vehicleId) || null;
    }
    requestRameTransfer(depotId, rame, context = {}) {
        if (context.policy?.enabled === false)
            return { ok: false, reason: 'Acheminements dépôt désactivés.' };
        const destination = this.getDepotById(depotId), origin = this.getDepotById(rame?.currentLocation?.depotId);
        if (!rame || !destination?.built)
            return { ok: false, reason: 'Rame ou dépôt inconnu.' };
        if (this.physicalOperations.some(op => op.rameId === rame.id && op.state !== 'done'))
            return { ok: false, reason: 'Acheminement physique déjà engagé.' };
        if (this._rameHasActiveService(rame, context.services) || rame.depotOperationId || rame.inMaintenance)
            return { ok: false, reason: 'Formation occupée par un service ou un atelier.' };
        const from = origin?.location || rescuePoint(rame.currentLocation), to = destination.location;
        const checked = validatedRescueRoute(context.route, from, to);
        if (!checked || !from || !to)
            return { ok: false, reason: 'Itinéraire ferroviaire réel requis : extrémités non reliées.' };
        if (context.policy?.enforce !== false && !context.driverId)
            return { ok: false, reason: 'Conducteur réel requis pour cet acheminement.' };
        if (!(rame.totalPower > 0) || !(rame.totalMass > 0) || !(rame.totalLength > 0) || !(rame.maxSpeed > 0))
            return { ok: false, reason: 'Caractéristiques physiques de traction, masse, longueur ou vitesse manquantes.' };
        const track = destination.trackOccupancy.find(s => !s.rameId && !s.operationId && (!destination.trackDefinitions[s.track - 1]?.lengthM || destination.trackDefinitions[s.track - 1].lengthM >= rame.totalLength));
        if (!track)
            return { ok: false, reason: 'Aucune voie destination libre de longueur compatible.' };
        const registry = (context.rotationV2 || context.game?.rotationV2 || globalThis.window?.game?.rotationV2);
        const vehicleIds = (rame.elementDetails || []).map((d, index) => String(d.physicalVehicleId || registry?.getRameElementVehicle?.(rame.id, index)?.id || '')).filter(Boolean);
        if (!vehicleIds.length)
            return { ok: false, reason: 'Identités physiques des véhicules requises avant acheminement.' };
        const services = context.services || context.game?.scheduleCreator.services || globalThis.window?.game?.scheduleCreator.services || [];
        const runtime = context.game?.scheduleV2Runtime || globalThis.window?.game?.scheduleV2Runtime;
        if (vehicleIds.some(vehicleId => {
            const v = this._depotMovementVehicle(vehicleId, rame, context), ids = new Set([vehicleId, String(v?.id || '')]);
            const prepared = !!runtime && services.some(svc => svc._v2OccurrenceId && Number(svc.currentStopIndex || 0) === 0 && ['waiting', 'garage', 'preparation'].includes(String(svc.state)) && svc._v2VehicleIds?.some(id => ids.has(String(id))) && !serviceUsesRame(svc, rame.id, ids));
            return !v || v._shuntingOwnerId || v._depotMovementOwnerId || v._v2OperationOwnerServiceId || v.available === false && !prepared;
        }))
            return { ok: false, reason: 'Véhicule physique indisponible ou déjà réservé.' };
        if (this.physicalOperations.some(op => op.state !== 'done' && op.vehicleIds.some(id => vehicleIds.includes(id))))
            return { ok: false, reason: 'Un véhicule est déjà engagé dans une autre manœuvre.' };
        const id = `depot-move-${this.nextPhysicalOperationId}`;
        if (context.policy?.enforce && !context.staffManager?.reserveDriver)
            return { ok: false, reason: 'Gestionnaire de conducteur physique requis.' };
        if (context.driverId && context.staffManager?.reserveDriver) {
            const driver = context.staffManager.reserveDriver(context.driverId, { game: context.game || globalThis.window?.game, ownerId: id, locationId: origin?.id || rame.currentLocation?.stationId || '', nowEpochMs: depotFinite(context.nowSec) * 1000 });
            if (!driver.ok || (context.policy?.enforce && driver.delegated))
                return { ok: false, reason: driver.reason || 'Conducteur physique indisponible.' };
        }
        this.nextPhysicalOperationId++;
        const op = { id, rameId: rame.id, vehicleIds, originDepotId: origin?.id || '', destinationDepotId: destination.id, destinationTrack: track.track,
            driverId: String(context.driverId || ''), route: checked.map(p => ({ ...p })), position: { ...from }, lastSec: depotFinite(context.nowSec), speedKmh: depotClamp(context.speedKmh || 30, 1, Math.min(100, rame.maxSpeed)), state: 'planned', reason: '', distanceKm: 0 };
        retirePreparedRameServices(rame.id, this._depotRameVehicleIds(rame, context), services, runtime);
        op.availabilityBefore = Object.fromEntries(vehicleIds.map(vehicleId => [vehicleId, this._depotMovementVehicle(vehicleId, rame, context).available ?? null]));
        track.operationId = id;
        this.physicalOperations.push(op);
        this.reconcilePhysicalReservations(context);
        return { ok: true, operationId: id, operation: op };
    }
    reconcilePhysicalReservations(context = {}) {
        for (const op of this.physicalOperations) {
            if (op.state === 'done')
                continue;
            const rame = (context.rameManager || context.game?.rameManager || globalThis.window?.game?.rameManager)?.getById?.(op.rameId);
            for (const id of op.vehicleIds) {
                const v = this._depotMovementVehicle(id, rame, context);
                if (!v)
                    continue;
                if (v._shuntingOwnerId || v._depotMovementOwnerId && v._depotMovementOwnerId !== op.id) {
                    op.reason = 'Véhicule réservé par une autre opération physique.';
                    continue;
                }
                v._depotMovementOwnerId = op.id;
                v.available = false;
            }
        }
    }
    _prepareDepotMovement(op, context = {}) {
        if (op.state === 'done')
            return null;
        const existing = this._depotMovements.get(op.id);
        if (existing)
            return existing;
        const game = context.game || globalThis.window?.game;
        const rame = (context.rameManager || game?.rameManager)?.getById?.(op.rameId), world = context.world || game?.world;
        if (!rame || !world)
            return null;
        // A physics view references the existing IDs; it never enters the
        // inventory or duplicates vehicles in the ownership registry.
        const material = new Rame({ id: `${op.id}:view`, name: rame.name, elementDetails: rame.elementDetails.map((d) => ({ ...d })), consumables: op.movementSnapshot?.consumables || rame.consumables });
        const controller = new RescueMovement(op.id, material, world, context.weather || game?.weather);
        cantonManager.createRouteCantons(op.route);
        this._depotMovements.set(op.id, controller);
        controller.configure(op.route, op.position, false, null, op.movementSnapshot);
        controller.setPhaseLimit(op.speedKmh);
        if (context.economy || game?.economy)
            controller._economy = (context.economy || game?.economy);
        controller._currentDate = context.date || game?._currentDate || '';
        return controller;
    }
    advancePhysicalOperations(nowSec, context = {}) {
        const finished = [], now = Number(nowSec);
        if (!Number.isFinite(now))
            return finished;
        const game = globalThis.window?.game || context.game || context;
        if (context.rameManager)
            this.updateDepotOperations(0, context.rameManager, context.staffManager);
        this.reconcilePhysicalReservations(context);
        for (const op of this.physicalOperations) {
            if (op.state === 'done')
                continue;
            const rame = context.rameManager?.getById?.(op.rameId), destination = this.getDepotById(op.destinationDepotId), origin = this.getDepotById(op.originDepotId);
            if (!rame || !destination) {
                op.reason = 'Matériel ou dépôt destination absent.';
                continue;
            }
            const controller = this._prepareDepotMovement(op, context);
            if (!controller) {
                op.reason = 'Monde physique ou formation absent : acheminement suspendu.';
                continue;
            }
            if (op.state === 'planned') {
                if (origin) {
                    const released = this.leaveRame(origin.id, rame, context.services);
                    if (!released.ok) {
                        op.reason = released.reason || 'Sortie dépôt refusée.';
                        continue;
                    }
                }
                rame.currentLocation = { depotId: '', stationId: '', serviceId: op.id, ...op.position };
                op.state = 'moving';
                for (const vehicleId of op.vehicleIds) {
                    const vehicle = this._depotMovementVehicle(vehicleId, rame, context);
                    if (vehicle)
                        vehicle.location = { kind: 'TRANSIT', id: op.id, lat: null, lon: null };
                }
            }
            let remaining = Math.max(0, now - op.lastSec);
            op.lastSec = now;
            let clock = this._depotMovementClocks.get(controller);
            // Shared movement authority, adhesion, braking, works and tail locks.
            while (remaining > 1e-9 && !controller.arrived) {
                const dt = Math.min(.1, remaining), stepSec = now - remaining, minute = Math.floor(stepSec / 60);
                if (!clock || minute !== clock.minute) {
                    const date = civilDateAt(minute * 60000);
                    clock = { minute, date, civilMinuteSec: civilRelativeSec(date, minute * 60000) };
                    this._depotMovementClocks.set(controller, clock);
                }
                controller._currentDate = clock.date;
                controller.moveUpdate(dt, (clock.civilMinuteSec + stepSec - minute * 60) / 60, context.services || []);
                remaining -= dt;
            }
            const movedKm = Math.max(0, controller.totalDistance - op.distanceKm);
            if (movedKm > 0) {
                // The movement view owns the integrator, while the real material
                // owns its counters. The saved operation distance prevents a
                // repeated advance or reload from booking the same metres twice.
                advanceMaterialMileage(rame, controller.train, movedKm);
                if (controller.rame)
                    for (const key of ['totalKmRun', 'kmSinceLastMaint', 'wearLevel'])
                        controller.rame[key] = rame[key];
                const movedVehicles = new Set();
                for (const vehicleId of op.vehicleIds) {
                    const vehicle = this._depotMovementVehicle(vehicleId, rame, context);
                    if (vehicle && !movedVehicles.has(vehicle)) {
                        movedVehicles.add(vehicle);
                        vehicle.odometerKm = Math.max(0, Number(vehicle.odometerKm) || 0) + movedKm;
                    }
                }
                const fleet = globalThis.window?.__reDefinitif;
                try {
                    fleet?.trackRameMileage?.(rame.id, movedKm);
                }
                catch (error) {
                    console.warn('[RE Definitif] physical mileage bridge:', error);
                }
            }
            op.position = controller.position ? { ...controller.position } : op.position;
            op.movementSnapshot = controller.snapshot();
            op.distanceKm = controller.totalDistance;
            op.reason = controller.train.delayReason || '';
            rame.currentLocation = { depotId: '', stationId: '', serviceId: op.id, ...op.position };
            rame.consumables = { ...(controller.rame?.consumables || rame.consumables) };
            if (controller.arrived) {
                const slot = destination.trackOccupancy.find(s => s.track === op.destinationTrack);
                if (slot?.operationId !== op.id || slot.rameId) {
                    op.reason = 'Voie destination réservée perdue : attente physique.';
                    continue;
                }
                // Arrival at the real endpoint authorises the atomic parking commit.
                rame.currentLocation = { stationId: destination.stationId, ...destination.location };
                const result = this.enterRame(destination.id, rame, context.services, { operationId: op.id, track: op.destinationTrack });
                if (!result.ok) {
                    op.reason = result.reason || 'Entrée dépôt refusée.';
                    continue;
                }
                slot.operationId = '';
                op.state = 'done';
                controller._releaseAllPhysicalResources();
                this._depotMovements.delete(op.id);
                for (const vehicleId of op.vehicleIds) {
                    const vehicle = this._depotMovementVehicle(vehicleId, rame, context);
                    if (vehicle) {
                        vehicle.location = { kind: 'DEPOT', id: destination.id, lat: destination.location?.lat ?? null, lon: destination.location?.lon ?? null };
                        if (vehicle._depotMovementOwnerId === op.id) {
                            delete vehicle._depotMovementOwnerId;
                            const before = op.availabilityBefore?.[vehicleId];
                            if (typeof before === 'boolean')
                                vehicle.available = before;
                            else
                                delete vehicle.available;
                        }
                    }
                }
                context.staffManager?.releaseDriver?.(op.driverId, op.id, destination.id, now * 1000);
                game.emitDomainEvent?.({ eventId: `depot-arrival:${op.id}`, simEpochMs: now * 1000, type: 'DepotMovementCompleted', resourceIds: op.vehicleIds, payload: { depotId: destination.id } });
                finished.push({ ...op });
            }
        }
        return finished;
    }
    _localRepairVehicle(vehicleId, depotId, context) {
        const depot = this.getDepotById(depotId);
        if (!depot?.built)
            return null;
        const parked = depot.vehiclePositions.find(p => p.vehicleId === String(vehicleId));
        if (!parked)
            return null;
        return context.rameManager?.getById?.(parked.rameId) || null;
    }
    requestComponentRepair({ vehicleId, component, depotId }, context = {}) {
        const rame = this._localRepairVehicle(vehicleId, depotId, context), part = String(component || '').toLowerCase();
        if (!rame)
            return { ok: false, reason: 'Véhicule physique absent de ce dépôt.' };
        const opId = Object.entries(REPAIR_COMPONENT_BY_OPERATION).find(([, value]) => value === part)?.[0];
        if (!opId)
            return { ok: false, reason: 'Composant inconnu ou intervention non prise en charge.' };
        const policy = context.policy || {};
        if (policy.enforce !== false && !context.staffManager)
            return { ok: false, reason: 'Personnel atelier réel requis.' };
        const economy = context.economy || globalThis.window?.game?.economy;
        if (!economy)
            return { ok: false, reason: 'Comptabilité du jeu indisponible.' };
        return this.startDepotOperation(depotId, rame, opId, economy, context.staffManager, vehicleId, context.policy);
    }
    requestComfortRepair({ vehicleId, code, depotId }, context = {}) {
        const rame = this._localRepairVehicle(vehicleId, depotId, context), part = String(code || '').trim();
        if (!rame)
            return { ok: false, reason: 'Voiture physique absente de ce dépôt.' };
        const ext = context.operationalExtensions || globalThis.window?.game?.operationalExtensions;
        if (!(ext?.comfortDefects?.get(String(vehicleId)) || []).includes(part))
            return { ok: false, reason: 'Défaut de confort absent de cette voiture.' };
        const normalized = part.toLowerCase(), opId = /^wc|toilet/.test(normalized) ? 'wc_repair' : /porte/.test(normalized) ? 'door_repair' : /clim|chauff|hvac/.test(normalized) ? 'hvac_replace' : /prise|éclair|eclair|socket|light/.test(normalized) ? 'socket_repair' : /siège|siege|seat/.test(normalized) ? 'seat_repair' : /saleté|salete|graffiti/.test(normalized) ? 'interior_clean' : '';
        if (!opId)
            return { ok: false, reason: 'Équipement confort non reconnu.' };
        if (context.policy?.enforce !== false && !context.staffManager)
            return { ok: false, reason: 'Personnel atelier réel requis.' };
        const economy = context.economy || globalThis.window?.game?.economy;
        if (!economy)
            return { ok: false, reason: 'Comptabilité du jeu indisponible.' };
        const result = this.startDepotOperation(depotId, rame, opId, economy, context.staffManager, '', context.policy);
        if (result.ok && result.operation) {
            result.operation.targetVehicleId = String(vehicleId);
            result.operation.comfortCode = part;
        }
        return result;
    }
    getDepotOccupancy(depotId) { const d = this.getDepotById(depotId); return d ? { used: d.occupancyCount(), capacity: d.tracks, free: d.freeTrackCount(), tracks: d.trackOccupancy.map((x) => ({ ...x })) } : { used: 0, capacity: 0, free: 0, tracks: [] }; }
    addDepotTracks(depotId, count, economy) {
        const depot = this.getDepotById(depotId);
        count = Math.floor(Number(count));
        if (!depot || depot.type !== 'depot' || !economy || !Number.isFinite(count) || count <= 0)
            return { ok: false, reason: 'Extension invalide.' };
        const allowed = Math.min(count, Math.max(0, 60 - depot.tracks));
        if (allowed <= 0)
            return { ok: false, reason: 'Capacité maximale atteinte (60 voies).' };
        const cost = allowed * DEPOT_TRACK_EXPANSION_COST;
        if (depotBudgetRequired() && Number(economy.balance) < cost)
            return { ok: false, cost, reason: 'Fonds insuffisants.' };
        if (economy.addExpense(cost, 'construction', `Extension ${depot.name} — ${allowed} voie(s) de garage`) !== true)
            return { ok: false, cost, reason: 'Paiement refusé.' };
        depot.appendTracks(allowed);
        depot.utilityTotals.expenseEur += cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Extension +${allowed} voie(s)`, amount: cost, category: 'infrastructure' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        return { ok: true, cost, count: allowed, tracks: depot.tracks };
    }
    buyEquipment(depotId, equipmentId, economy) {
        const equipmentKey = String(equipmentId || '');
        const depot = this.getDepotById(depotId), def = DEPOT_EQUIPMENT_CATALOG[equipmentKey];
        if (!depot || depot.type !== 'depot' || !def || !economy)
            return { ok: false, reason: 'Équipement invalide.' };
        const cur = depot.equipmentCount(equipmentKey);
        if (cur >= (def.maxCount || 1))
            return { ok: false, reason: 'Nombre maximal déjà installé.' };
        if (depotBudgetRequired() && Number(economy.balance) < def.price)
            return { ok: false, cost: def.price, reason: 'Fonds insuffisants.' };
        if (economy.addExpense(def.price, 'construction', `${depot.name} — ${def.label}`) !== true)
            return { ok: false, cost: def.price, reason: 'Paiement refusé.' };
        depot.addEquipment(equipmentKey, 1);
        depot.utilityTotals.expenseEur += def.price;
        depot.expenseLedger.push({ time: Date.now(), label: `Équipement : ${def.label}`, amount: def.price, category: 'équipement' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        return { ok: true, cost: def.price, count: depot.equipmentCount(equipmentKey) };
    }
    _equipmentBusyCount(depotId, equipmentId) { return this.depotOperations.filter((o) => o.depotId === String(depotId || '') && o.state === 'running' && Array.isArray(o.equipment) && o.equipment.includes(equipmentId)).length; }
    getEquipmentAvailability(depotId, equipmentId) { const depot = this.getDepotById(depotId), installed = depot?.equipmentCount?.(equipmentId) || 0, busy = this._equipmentBusyCount(depotId, equipmentId); return { installed, busy, free: Math.max(0, installed - busy) }; }
    buyResource(depotId, key, qty, economy) {
        const resourceKey = String(key || '');
        const depot = this.getDepotById(depotId), def = DEPOT_RESOURCE_CATALOG[resourceKey];
        qty = Number(qty);
        if (!depot || depot.type !== 'depot' || !depot.built || !def?.stock || !economy || !Number.isFinite(qty) || qty <= 0)
            return { ok: false, cost: 0 };
        const cap = Number(depot.resourceCapacities[resourceKey] || 0), cur = Number(depot.resourceStocks[resourceKey] || 0);
        const pending = this.supplyOrders.filter(o => o.depotId === depot.id && o.kind === 'resource' && o.key === resourceKey).reduce((sum, o) => sum + o.qty, 0);
        const add = Math.min(qty, Math.max(0, cap - cur - pending));
        if (add <= 0)
            return { ok: false, cost: 0, reason: 'Stock déjà plein' };
        const cost = add * def.price;
        if (depotBudgetRequired() && Number(economy.balance) < cost)
            return { ok: false, cost, reason: 'Fonds insuffisants' };
        if (economy.addExpense(cost, 'maintenance', `Approvisionnement ${depot.name} — ${def.label} ${add.toFixed(def.unit === 'L' ? 0 : 1)} ${def.unit}`) !== true)
            return { ok: false, cost, reason: 'Paiement refusé.' };
        const orderId = `supply-${nextDepotSupplyOrderId++}`;
        this.supplyOrders.push({ orderId, depotId: depot.id, kind: 'resource', key: resourceKey, qty: add, remainingMin: 120, totalMin: 120, accelerated: false });
        depot.utilityTotals.expenseEur += cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Commande ${def.label}`, amount: cost, category: 'approvisionnement' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        return { ok: true, cost, qty: add, orderId };
    }
    buyPart(depotId, partId, qty, economy) {
        const depot = this.getDepotById(depotId), part = DEPOT_PART_CATALOG.find((p) => p.id === partId);
        qty = Math.floor(Number(qty));
        if (!depot || depot.type !== 'depot' || !depot.built || !part || !economy || !Number.isFinite(qty) || qty <= 0)
            return { ok: false, cost: 0 };
        const cost = part.price * qty;
        if (depotBudgetRequired() && Number(economy.balance) < cost)
            return { ok: false, cost, reason: 'Fonds insuffisants' };
        if (economy.addExpense(cost, 'maintenance', `Pièces ${depot.name} — ${part.label} x${qty}`) !== true)
            return { ok: false, cost, reason: 'Paiement refusé.' };
        const orderId = `supply-${nextDepotSupplyOrderId++}`;
        this.supplyOrders.push({ orderId, depotId: depot.id, kind: 'part', key: part.id, qty, remainingMin: 120, totalMin: 120, accelerated: false });
        depot.utilityTotals.expenseEur += cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Commande : ${part.label} x${qty}`, amount: cost, category: 'pièces' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        return { ok: true, cost, orderId };
    }
    _operationAlreadyRunning(depotId, rameId, opId, targetVehicleId = '') {
        return this.depotOperations.some(operation => operation.depotId === depotId && operation.rameId === rameId && operation.state === 'running' &&
            (operation.opId === opId && (!operation.targetVehicleId || operation.targetVehicleId === targetVehicleId) ||
                operation.opId === 'full_refill' && ['refuel', 'sand_fill', 'washer_fill', 'fluid_service', 'full_refill'].includes(opId)));
    }
    /** Suggested work uses existing depot operations; it does not start repairs. */
    getRequiredDepotOperations(depotId, rames = []) {
        const depot = this.getDepotById(depotId);
        if (!depot || depot.type !== 'depot' || !depot.built)
            return [];
        const byDefect = { moteur: 'engine_replace', freins: 'brake_overhaul', portes: 'door_repair', fanaux: 'headlight_replace',
            climatisation: 'hvac_replace', traction: 'traction_motor_replace', moteur_traction: 'traction_motor_replace',
            pantographe: 'pantograph_replace', compresseur: 'compressor_replace', batterie: 'battery_service' };
        const out = [];
        for (const rame of Array.isArray(rames) ? rames : []) {
            if (!rame?.id || rame.currentLocation?.depotId !== depot.id || !depot.findRameTrack(rame.id))
                continue;
            const vehicleIds = depotVehicleIds(rame), extensions = globalThis.window?.game?.operationalExtensions;
            const ids = [...new Set((rame.pendingDefects || []).map((defect) => byDefect[String(defect)]).filter(Boolean))];
            if (extensions?.componentCondition)
                for (const [opId, component] of Object.entries(REPAIR_COMPONENT_BY_OPERATION))
                    if (vehicleIds.some(id => Number(extensions.componentCondition(id, component)) < 100))
                        ids.push(opId);
            if (Number(rame.wearLevel || 0) >= 20 || rame.recommendedMaintenance)
                ids.push('routine_service');
            const c = depotConsumableLevels(rame);
            if (Number(c.fuelCapacityL || 0) > Number(c.fuelL || 0))
                ids.push('refuel');
            if (Number(c.sandCapacityKg || 0) > Number(c.sandKg || 0))
                ids.push('sand_fill');
            if (Number(c.washerCapacityL || 0) > Number(c.washerL || 0))
                ids.push('washer_fill');
            if (['oil', 'coolant', 'adblue', 'gearboxOil', 'hydraulicOil'].some(k => Number(c[k + 'CapacityL'] || 0) > Number(c[k + 'L'] || 0)))
                ids.push('fluid_service');
            for (const opId of new Set(ids)) {
                const component = REPAIR_COMPONENT_BY_OPERATION[String(opId)];
                const targets = component && extensions?.componentCondition ? vehicleIds.filter(id => Number(extensions.componentCondition(id, component)) < 100) : [];
                for (const targetVehicleId of targets.length ? targets : ['']) {
                    if (this._operationAlreadyRunning(depot.id, rame.id, opId, targetVehicleId))
                        continue;
                    const need = this._operationNeeds(rame, opId, targetVehicleId);
                    if (need && !need.nothing) {
                        const detailIndex = vehicleIds.indexOf(targetVehicleId), detail = targetVehicleId ? rame.elementDetails?.[detailIndex] : null;
                        const vehicle = targetVehicleId ? globalThis.window?.game?.rotationV2?.getVehicle?.(targetVehicleId) : null;
                        out.push({ rameId: rame.id, rameName: String(rame.name || rame.id), opId, targetVehicleId,
                            targetVehicleName: String(vehicle?.number || vehicle?.name || detail?.instanceName || detail?.name || targetVehicleId), label: need.def.label,
                            durationMin: depot.getMaintenanceDuration(need.def.duration), resources: { ...need.resources }, parts: { ...need.parts },
                            equipment: [...(need.def.equipment || [])], staff: { ...(need.def.staff || {}) } });
                    }
                }
            }
        }
        return out;
    }
    /** Computes a single order from required operations or fills every stocked resource. */
    quoteDepotBulkSupply(depotId, { fillResources = false, operations = [] } = {}) {
        const depot = this.getDepotById(depotId);
        if (!depot || depot.type !== 'depot' || !depot.built || !Array.isArray(operations) || operations.length > 1000)
            return { ok: false, reason: 'Dépôt ou sélection invalide.' };
        const resourceNeeds = Object.create(null), partNeeds = Object.create(null), seen = new Set();
        for (const row of operations) {
            const rame = row?.rame, opId = String(row?.opId || ''), targetVehicleId = String(row?.targetVehicleId || '');
            if (!rame?.id || rame.currentLocation?.depotId !== depot.id || !depot.findRameTrack(rame.id) || !DEPOT_OPERATION_CATALOG[opId])
                return { ok: false, reason: 'Matériel ou opération indisponible dans ce dépôt.' };
            if (targetVehicleId && (!REPAIR_COMPONENT_BY_OPERATION[String(opId)] || !depotVehicleIds(rame).includes(targetVehicleId) ||
                !(Number(globalThis.window?.game?.operationalExtensions?.componentCondition?.(targetVehicleId, REPAIR_COMPONENT_BY_OPERATION[String(opId)])) < 100)))
                return { ok: false, reason: 'Engin ou composant incompatible avec cette opération.' };
            const key = `${rame.id}\0${opId}\0${targetVehicleId}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            if (this._operationAlreadyRunning(depot.id, rame.id, opId, targetVehicleId))
                continue;
            const need = this._operationNeeds(rame, opId, targetVehicleId);
            if (!need || need.nothing)
                continue;
            for (const [id, qty] of Object.entries(need.resources))
                if (DEPOT_RESOURCE_CATALOG[id]?.stock)
                    resourceNeeds[id] = (resourceNeeds[id] || 0) + Math.max(0, Number(qty) || 0);
            for (const [id, qty] of Object.entries(need.parts))
                partNeeds[id] = (partNeeds[id] || 0) + Math.max(0, Number(qty) || 0);
        }
        if (fillResources)
            for (const [key, def] of Object.entries(DEPOT_RESOURCE_CATALOG))
                if (def.stock)
                    resourceNeeds[key] = Math.max(Number(resourceNeeds[key]) || 0, Number(depot.resourceCapacities[key]) || 0);
        const lines = [], pending = (kind, key) => this.supplyOrders
            .filter(o => o.depotId === depot.id && o.kind === kind && o.key === key).reduce((sum, o) => sum + Math.max(0, Number(o.qty) || 0), 0);
        for (const [key, required] of Object.entries(resourceNeeds)) {
            const def = DEPOT_RESOURCE_CATALOG[key], capacity = Number(depot.resourceCapacities[key]) || 0, stock = depot.availableResourceStock(key);
            const incoming = pending('resource', key), qty = Math.max(0, required - stock - incoming);
            if (required > capacity + 1e-9)
                return { ok: false, reason: `Capacité insuffisante : ${def.label} (${required} requis, ${capacity} disponibles).` };
            if (qty > 1e-9)
                lines.push({ kind: 'resource', key, label: def.label, unit: def.unit, required, stock, pending: incoming, qty, unitPrice: def.price, subtotal: 0, discount: 0, total: 0 });
        }
        for (const [key, required] of Object.entries(partNeeds)) {
            const def = DEPOT_PART_CATALOG.find(part => part.id === key);
            if (!def)
                return { ok: false, reason: `Pièce inconnue : ${key}.` };
            const stock = depot.availablePartStock(key), incoming = pending('part', key), qty = Math.max(0, Math.ceil(required - stock - incoming));
            if (qty)
                lines.push({ kind: 'part', key, label: def.label, unit: 'u', required, stock, pending: incoming, qty, unitPrice: def.price, subtotal: 0, discount: 0, total: 0 });
        }
        if (!lines.length)
            return { ok: false, reason: 'Stocks et livraisons déjà suffisants.' };
        const subtotal = Math.round(lines.reduce((sum, row) => sum + row.qty * row.unitPrice, 0) * 100) / 100;
        const discountRate = subtotal >= 100000 ? 0.15 : subtotal >= 30000 ? 0.10 : subtotal >= 5000 ? 0.05 : 0;
        for (const line of lines) {
            line.subtotal = Math.round(line.qty * line.unitPrice * 100) / 100;
            line.discount = Math.round(line.subtotal * discountRate * 100) / 100;
            line.total = Math.round((line.subtotal - line.discount) * 100) / 100;
        }
        const discount = Math.round(lines.reduce((sum, row) => sum + row.discount, 0) * 100) / 100;
        return { ok: true, depotId: depot.id, lines, subtotal, discount, discountRate, total: Math.round((subtotal - discount) * 100) / 100,
            request: { fillResources: fillResources === true, operations } };
    }
    /** A stale quote is rejected before payment. One charge creates all deliveries. */
    placeDepotBulkSupplyOrder(depotId, quote, economy) {
        const current = this.quoteDepotBulkSupply(depotId, quote?.request);
        if (!quote?.ok || !current.ok || String(quote.depotId) !== String(depotId) || quote.total !== current.total ||
            JSON.stringify(quote.lines) !== JSON.stringify(current.lines))
            return { ok: false, reason: 'Le devis a changé : recommencez.' };
        if (!economy || !Number.isFinite(Number(economy.balance)) ||
            (globalThis.window?.game?.realismSettings?.difficulty === 'expert' && economy.balance < current.total))
            return { ok: false, reason: 'Fonds insuffisants.', total: current.total };
        let paid = false;
        try {
            paid = economy.addExpense(current.total, 'maintenance', `Approvisionnement groupé ${this.getDepotById(depotId).name}`) === true;
        }
        catch (_error) { /* Failed payments leave every order and stock untouched. */ }
        if (!paid)
            return { ok: false, reason: 'Paiement refusé.' };
        const depot = this.getDepotById(depotId), orderIds = [];
        for (const row of current.lines) {
            const orderId = `supply-${nextDepotSupplyOrderId++}`;
            this.supplyOrders.push({ orderId, depotId: depot.id, kind: row.kind, key: row.key, qty: row.qty,
                remainingMin: 120, totalMin: 120, accelerated: false });
            orderIds.push(orderId);
        }
        depot.utilityTotals.expenseEur += current.total;
        depot.expenseLedger.push({ time: Date.now(), label: `Commande groupée (${orderIds.length} références, remise ${Math.round(current.discountRate * 100)} %)`,
            amount: current.total, category: 'approvisionnement' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        return { ok: true, orderIds, total: current.total, discount: current.discount };
    }
    quoteSupplyAcceleration(orderId) {
        const order = this.supplyOrders.find(o => o.orderId === String(orderId));
        if (!order)
            return { ok: false, reason: 'Commande introuvable.' };
        if (order.accelerated || order.remainingMin <= 1)
            return { ok: false, reason: 'Commande déjà accélérée ou presque livrée.' };
        if (!this.getDepotById(order.depotId)?.built)
            return { ok: false, reason: 'Dépôt indisponible.' };
        return { ok: true, cost: Math.round(250 + Math.ceil(order.remainingMin - 1) * 10) };
    }
    accelerateSupplyOrder(orderId, expectedCost, economy) {
        const quote = this.quoteSupplyAcceleration(orderId);
        if (!quote.ok)
            return quote;
        if (!Number.isFinite(Number(expectedCost)) || Number(expectedCost) !== quote.cost)
            return { ok: false, reason: 'Le devis a changé : réessayez.' };
        if (!economy || !Number.isFinite(Number(economy.balance)) || depotBudgetRequired() && economy.balance < quote.cost)
            return { ok: false, reason: 'Fonds insuffisants.' };
        const order = this.supplyOrders.find(o => o.orderId === String(orderId));
        if (economy.addExpense(quote.cost, 'maintenance', `Accélération commande ${order.key}`) !== true)
            return { ok: false, reason: 'Paiement refusé.' };
        const depot = this.getDepotById(order.depotId);
        depot.utilityTotals.expenseEur += quote.cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Accélération commande ${order.key}`, amount: quote.cost, category: 'approvisionnement' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        order.remainingMin = 1;
        order.accelerated = true;
        return { ok: true, cost: quote.cost };
    }
    _operationNeeds(rame, opId, targetVehicleId = '') {
        const opKey = String(opId || '');
        const def = DEPOT_OPERATION_CATALOG[opKey];
        if (!def)
            return null;
        if (def.dynamic === 'full_refill') {
            const resources = {}, parts = {}, staff = {}, equipment = new Set();
            let duration = 0;
            for (const stage of ['refuel', 'sand_fill', 'washer_fill', 'fluid_service']) {
                const need = this._operationNeeds(rame, stage);
                if (!need || need.nothing || (stage === 'fluid_service' &&
                    !['engine_oil_l', 'coolant_l', 'adblue_l', 'gearbox_oil_l', 'hydraulic_oil_l'].some(key => Number(need.resources[key]) > 0)))
                    continue;
                duration += need.def.duration;
                for (const [key, qty] of Object.entries(need.resources))
                    resources[key] = (resources[key] || 0) + Number(qty || 0);
                for (const [key, qty] of Object.entries(need.def.staff || {}))
                    staff[key] = Math.max(staff[key] || 0, Number(qty) || 0);
                for (const item of need.def.equipment || [])
                    equipment.add(item);
            }
            return { def: { ...def, duration, staff, equipment: [...equipment] }, resources, parts, nothing: duration === 0 };
        }
        const resources = { ...(def.resources || {}) }, parts = { ...(def.parts || {}) };
        const c = depotConsumableLevels(rame);
        if (def.dynamic === 'fuel') {
            const missing = Math.max(0, Number(c.fuelCapacityL || 0) - Number(c.fuelL || 0));
            if (missing <= 0)
                return { def, resources, parts, nothing: true };
            resources.diesel_l = missing;
        }
        if (def.dynamic === 'sand') {
            const missing = Math.max(0, Number(c.sandCapacityKg || 0) - Number(c.sandKg || 0));
            if (missing <= 0)
                return { def, resources, parts, nothing: true };
            resources.sand_kg = missing;
        }
        if (def.dynamic === 'fluids') {
            resources.engine_oil_l = Math.max(0, Number(c.oilCapacityL || 0) - Number(c.oilL || 0));
            resources.coolant_l = Math.max(0, Number(c.coolantCapacityL || 0) - Number(c.coolantL || 0));
            if (Number(c.adblueCapacityL || 0) > 0)
                resources.adblue_l = Math.max(0, Number(c.adblueCapacityL || 0) - Number(c.adblueL || 0));
            if (Number(c.gearboxOilCapacityL || 0) > 0)
                resources.gearbox_oil_l = Math.max(0, Number(c.gearboxOilCapacityL || 0) - Number(c.gearboxOilL || 0));
            if (Number(c.hydraulicOilCapacityL || 0) > 0)
                resources.hydraulic_oil_l = Math.max(0, Number(c.hydraulicOilCapacityL || 0) - Number(c.hydraulicOilL || 0));
        }
        if (def.dynamic === 'washer') {
            const missing = Math.max(0, Number(c.washerCapacityL || 0) - Number(c.washerL || 0));
            if (missing <= 0)
                return { def, resources, parts, nothing: true };
            resources.washer_fluid_l = missing;
        }
        if (def.dynamic === 'engine') {
            const part = partForEngine(rame, targetVehicleId);
            parts[part?.id || 'engine_generic'] = 1;
        }
        return { def, resources, parts, nothing: false };
    }
    /** One timed, stock-backed refill operation per parked rame, with per-rame outcomes. */
    startAllDepotRefills(depotId, rames, economy, staffManager = null) {
        if (!Array.isArray(rames) || rames.length > 1000)
            return { ok: false, results: [], reason: 'Sélection de rames invalide.' };
        const seen = new Set(), results = [];
        for (const rame of rames) {
            const rameId = String(rame?.id || '');
            if (!rameId || seen.has(rameId))
                continue;
            seen.add(rameId);
            results.push({ rameId, ...this.startDepotOperation(depotId, rame, 'full_refill', economy, staffManager) });
        }
        return { ok: results.some(row => row.ok), results };
    }
    startDepotOperation(depotId, rame, opId, economy, staffManager = null, targetVehicleId = '', policy = null) {
        const physical = policy?.enforce ?? globalThis.window?.game?.resolveRealismPolicy?.('depots')?.enforce ?? (globalThis.window?.game?.realismSettings?.difficulty !== 'easy');
        const depot = this.getDepotById(depotId), need = this._operationNeeds(rame, opId, targetVehicleId);
        if (!depot || depot.type !== 'depot' || !rame || !need)
            return { ok: false, reason: 'Opération invalide' };
        targetVehicleId = String(targetVehicleId || '').trim();
        const targetComponent = targetVehicleId ? REPAIR_COMPONENT_BY_OPERATION[String(opId)] : '';
        if (targetVehicleId) {
            const owned = depotVehicleIds(rame).includes(targetVehicleId);
            const extensions = globalThis.window?.game?.operationalExtensions;
            if (!targetComponent || !owned || !extensions?.repairComponent)
                return { ok: false, reason: 'Engin ou composant incompatible avec cette opération.' };
            if (!(Number(extensions.componentCondition?.(targetVehicleId, targetComponent)) < 100))
                return { ok: false, reason: 'Aucun défaut de ce composant sur cet engin.' };
        }
        if (rame.currentLocation?.depotId !== depot.id || !depot.findRameTrack(rame.id))
            return { ok: false, reason: 'La rame doit d’abord être envoyée manuellement dans ce dépôt.' };
        if (rame.depotOperationId || this.depotOperations.some((o) => o.rameId === rame.id && o.state === 'running'))
            return { ok: false, reason: 'Une opération est déjà en cours sur cette rame.' };
        if (need.def.requires && !depot.hasInfrastructure(need.def.requires))
            return { ok: false, reason: `Équipement historique requis : ${need.def.requires}.` };
        const requiredEquipment = [...new Set((Array.isArray(need.def.equipment) ? need.def.equipment : []).map(String))];
        for (const equipmentId of requiredEquipment) {
            const def = DEPOT_EQUIPMENT_CATALOG[equipmentId], availability = this.getEquipmentAvailability(depot.id, equipmentId);
            if (physical && availability.installed <= 0)
                return { ok: false, reason: `Équipement requis : ${def?.label || equipmentId}.` };
            if (physical && availability.free <= 0)
                return { ok: false, reason: `Équipement occupé : ${def?.label || equipmentId}.` };
        }
        if (physical && staffManager?.checkDepotStaff) {
            const staffCheck = staffManager.checkDepotStaff(depot.id, need.def.staff || {});
            if (!staffCheck.ok) {
                const txt = staffCheck.shortages.map((x) => `${x.label} : ${x.free}/${x.need} disponible(s)`).join(' · ');
                return { ok: false, reason: `Personnel insuffisant : ${txt}. Affectez ou embauchez les agents nécessaires dans Personnel.` };
            }
        }
        if (need.nothing)
            return { ok: false, reason: 'Aucun complément nécessaire.' };
        for (const [key, qty] of Object.entries(need.resources)) {
            const def = DEPOT_RESOURCE_CATALOG[key];
            if (physical && def?.stock && depot.availableResourceStock(key) + 1e-9 < Number(qty || 0))
                return { ok: false, reason: (Number(depot.resourceStocks[key]) || 0) >= Number(qty || 0) ? `Stock en attente de paiement : ${def.label}. Consultez Logistique.` : `Stock insuffisant : ${def.label}.` };
        }
        for (const [key, qty] of Object.entries(need.parts)) {
            if (physical && depot.availablePartStock(key) < Number(qty || 0)) {
                const p = DEPOT_PART_CATALOG.find((x) => x.id === key);
                return { ok: false, reason: (Number(depot.partInventory[key]) || 0) >= Number(qty || 0) ? `Pièce en attente de paiement : ${p?.label || key}. Consultez Logistique.` : `Pièce manquante : ${p?.label || key}.` };
            }
        }
        let utilityCost = 0;
        for (const [key, qty] of Object.entries(need.resources)) {
            const def = DEPOT_RESOURCE_CATALOG[key];
            if (def && !def.stock)
                utilityCost += Number(qty || 0) * def.price;
        }
        if (utilityCost > 0 && (!economy?.addExpense || !Number.isFinite(Number(economy?.balance)) ||
            (globalThis.window?.game?.realismSettings?.difficulty === 'expert' && Number(economy.balance) < utilityCost)))
            return { ok: false, reason: 'Fonds insuffisants pour les fluides/énergies.' };
        const duration = depot.getMaintenanceDuration(need.def.duration);
        const id = `depot-op-${nextDepotOperationId++}`;
        const staffReservation = physical && staffManager?.reserveDepotStaff ? staffManager.reserveDepotStaff(depot.id, need.def.staff || {}, id, need.def.label) : { ok: true, staffIds: [] };
        if (!staffReservation?.ok)
            return { ok: false, reason: 'Personnel devenu indisponible avant le lancement de l’opération.' };
        // Reserve the full team before spending anything. Preflight availability is
        // advisory: a late reservation refusal must not consume stocks or cash.
        const reservedParts = physical ? need.parts : Object.fromEntries(Object.entries(need.parts).map(([key, qty]) => [key, Math.min(Number(qty), Number(depot.partInventory[key]) || 0)]));
        if (!depot.consumeParts(reservedParts)) {
            staffManager?.releaseDepotTask?.(id);
            return { ok: false, reason: 'Pièces insuffisantes' };
        }
        for (const [key, qty] of Object.entries(need.resources)) {
            const def = DEPOT_RESOURCE_CATALOG[key];
            if (!def)
                continue;
            const used = Math.max(0, Number(qty || 0));
            depot.resourceUsage[key] = (Number(depot.resourceUsage[key]) || 0) + used;
            if (def.stock)
                depot.resourceStocks[key] = Math.max(0, (Number(depot.resourceStocks[key]) || 0) - used);
            if (key === 'water_l')
                depot.utilityTotals.waterL += used;
            if (key === 'electricity_kwh')
                depot.utilityTotals.electricityKWh += used;
        }
        if (utilityCost > 0) {
            let paid = false;
            try {
                paid = economy.addExpense(utilityCost, 'maintenance', `${depot.name} — ${need.def.label} (eau/électricité)`) === true;
            }
            catch (_error) { /* The operation remains unstarted. */ }
            if (!paid) {
                for (const [key, qty] of Object.entries(reservedParts))
                    depot.addPart(key, qty);
                for (const [key, qty] of Object.entries(need.resources)) {
                    const used = Math.max(0, Number(qty || 0));
                    depot.resourceUsage[key] = Math.max(0, (Number(depot.resourceUsage[key]) || 0) - used);
                    if (DEPOT_RESOURCE_CATALOG[key]?.stock)
                        depot.resourceStocks[key] = (Number(depot.resourceStocks[key]) || 0) + used;
                    if (key === 'water_l')
                        depot.utilityTotals.waterL -= used;
                    if (key === 'electricity_kwh')
                        depot.utilityTotals.electricityKWh -= used;
                }
                staffManager?.releaseDepotTask?.(id);
                return { ok: false, reason: 'Paiement refusé.' };
            }
            depot.utilityTotals.expenseEur += utilityCost;
            depot.expenseLedger.push({ time: Date.now(), label: need.def.label, amount: utilityCost, category: 'énergie/eau' });
        }
        const op = { id, depotId: depot.id, rameId: rame.id, rameName: rame.name, opId, label: need.def.label, group: need.def.group, remainingMin: duration, totalMin: duration, state: 'running', staff: { ...(need.def.staff || {}) }, staffIds: [...(staffReservation.staffIds || [])], resources: need.resources, parts: need.parts, equipment: requiredEquipment, startedAt: globalThis.window?.game?.engine?.getSimulationEpochMs?.() ?? 0, targetVehicleId, targetComponent, resourceVehicleIds: depotVehicleIds(rame), enforced: physical };
        this.depotOperations.push(op);
        rame.depotOperationId = id;
        const slot = depot.findRameTrack(rame.id);
        if (slot) {
            slot.purpose = need.def.group;
            slot.operationId = id;
        }
        return { ok: true, operation: op, utilityCost };
    }
    updateDepotOperations(dt, rameManager, staffManager = null) {
        const step = Math.max(0, Number(dt) || 0), finished = [];
        for (const op of this.depotOperations) {
            if (op.state !== 'running')
                continue;
            const epoch = globalThis.window?.game?.engine?.getSimulationEpochMs?.();
            if (op.remainingMin > 0 && Number.isFinite(epoch) && op.startedAt != null && Number.isFinite(op.startedAt) && op.startedAt > 0)
                op.remainingMin = Math.min(op.remainingMin, Math.max(0, op.totalMin - (Number(epoch) - op.startedAt) / 60000));
            else
                op.remainingMin -= step;
            if (op.remainingMin <= 0) {
                op.remainingMin = 0;
                op.state = 'done';
                finished.push(op);
            }
        }
        for (const op of finished) {
            const rame = rameManager?.getById?.(op.rameId), depot = this.getDepotById(op.depotId);
            if (rame) {
                const c = (depotConsumableSources(rame).length ? {} : rame.consumables || {});
                refillIndividualLevels(rame, op);
                if (op.opId === 'refuel')
                    c.fuelL = Number(c.fuelCapacityL || 0);
                else if (op.opId === 'sand_fill')
                    c.sandKg = Number(c.sandCapacityKg || 0);
                else if (op.opId === 'fluid_service') {
                    c.oilL = Number(c.oilCapacityL || 0);
                    c.coolantL = Number(c.coolantCapacityL || 0);
                    c.adblueL = Number(c.adblueCapacityL || 0);
                    c.gearboxOilL = Number(c.gearboxOilCapacityL || 0);
                    c.hydraulicOilL = Number(c.hydraulicOilCapacityL || 0);
                    rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 3);
                }
                else if (op.opId === 'washer_fill')
                    c.washerL = Number(c.washerCapacityL || 0);
                else if (op.opId === 'lubrication')
                    rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 2);
                else if (op.opId === 'exterior_wash' || op.opId === 'deicing')
                    rame.cleanliness = { ...(rame.cleanliness || {}), exterior: 100 };
                else if (op.opId === 'interior_clean' || op.opId === 'deep_disinfection')
                    rame.cleanliness = { ...(rame.cleanliness || {}), interior: 100 };
                else if (op.opId === 'routine_service') {
                    rame.kmSinceLastMaint = 0;
                    rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 25);
                    rame.recommendedMaintenance = false;
                }
                else if (op.opId === 'brake_overhaul') {
                    rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 12);
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'freins');
                }
                else if (op.opId === 'wheel_reprofile') {
                    rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 10);
                }
                else if (op.opId === 'engine_replace') {
                    rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 20);
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'moteur');
                }
                else if (op.opId === 'traction_motor_replace')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => !['traction', 'moteur_traction'].includes(String(x)));
                else if (op.opId === 'pantograph_replace')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'pantographe');
                else if (op.opId === 'compressor_replace')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'compresseur');
                else if (op.opId === 'hvac_replace')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'climatisation');
                else if (op.opId === 'door_repair')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'portes');
                else if (op.opId === 'battery_service')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'batterie');
                else if (op.opId === 'headlight_replace')
                    rame.pendingDefects = (rame.pendingDefects || []).filter((x) => x !== 'fanaux');
                if (op.opId === 'full_refill') {
                    const levels = c;
                    for (const [level, capacity] of [['fuelL', 'fuelCapacityL'], ['sandKg', 'sandCapacityKg'],
                        ['washerL', 'washerCapacityL'], ['oilL', 'oilCapacityL'], ['coolantL', 'coolantCapacityL'],
                        ['adblueL', 'adblueCapacityL'], ['gearboxOilL', 'gearboxOilCapacityL'], ['hydraulicOilL', 'hydraulicOilCapacityL']])
                        levels[level] = Number(levels[capacity] || 0);
                    if (['engine_oil_l', 'coolant_l', 'adblue_l', 'gearbox_oil_l', 'hydraulic_oil_l'].some(key => Number(op.resources[key]) > 0))
                        rame.wearLevel = Math.max(0, Number(rame.wearLevel || 0) - 3);
                }
                if (op.targetVehicleId && op.comfortCode && depotVehicleIds(rame).includes(op.targetVehicleId))
                    globalThis.window?.game?.operationalExtensions?.repairComfortDefect?.(op.targetVehicleId, op.comfortCode);
                if (op.targetVehicleId && op.targetComponent && REPAIR_COMPONENT_BY_OPERATION[String(op.opId)] === op.targetComponent) {
                    const extensions = globalThis.window?.game?.operationalExtensions;
                    const ids = depotVehicleIds(rame);
                    if (ids.includes(op.targetVehicleId) && extensions?.repairComponent) {
                        extensions.repairComponent(op.targetVehicleId, op.targetComponent);
                        const defect = REPAIR_DEFECT_BY_OPERATION[String(op.opId)] || '';
                        if (defect && ids.some(id => id !== op.targetVehicleId && Number(extensions.componentCondition?.(id, op.targetComponent)) < 100) && !rame.pendingDefects.includes(defect))
                            rame.pendingDefects.push(defect);
                    }
                }
                rame.depotOperationId = '';
                globalThis.window?.game?.emitDomainEvent?.({ eventId: `maintenance:${op.id}`, simEpochMs: globalThis.window?.game?.engine?.getSimulationEpochMs?.() ?? op.startedAt ?? 0, type: 'maintenanceCompleted', resourceIds: op.targetVehicleId ? [op.targetVehicleId] : depotVehicleIds(rame), payload: { component: op.targetComponent, operation: op.opId } });
            }
            const slot = depot?.findRameTrack?.(op.rameId);
            if (slot) {
                slot.purpose = 'garage';
                slot.operationId = '';
            }
            staffManager?.releaseDepotTask?.(op.id);
        }
        this.depotOperations = this.depotOperations.filter((o) => o.state === 'running');
        return finished;
    }
    quoteDepotOperationCompletion(operationId) {
        const op = this.depotOperations.find(o => o.id === String(operationId));
        if (!op || op.state !== 'running' || !Number.isFinite(op.remainingMin) || op.remainingMin <= 0)
            return { ok: false, reason: 'Opération introuvable ou déjà terminée.' };
        const depot = this.getDepotById(op.depotId);
        if (!depot || depot.type !== 'depot' || !depot.built)
            return { ok: false, reason: 'Dépôt indisponible.' };
        return { ok: true, cost: Math.round(500 + Math.ceil(op.remainingMin) * 30) };
    }
    finishDepotOperationNow(operationId, expectedCost, economy, rameManager, staffManager = null) {
        const quote = this.quoteDepotOperationCompletion(operationId);
        if (!quote.ok)
            return quote;
        if (!Number.isFinite(Number(expectedCost)) || Number(expectedCost) !== quote.cost)
            return { ok: false, reason: 'Le devis a changé : réessayez.' };
        const op = this.depotOperations.find(o => o.id === String(operationId));
        const depot = this.getDepotById(op.depotId);
        const rame = rameManager?.getById?.(op.rameId);
        if (!rame || rame.depotOperationId !== op.id || !depot.findRameTrack(op.rameId))
            return { ok: false, reason: 'Rame indisponible : impossible de finaliser cette opération.' };
        if (!economy || !Number.isFinite(Number(economy.balance)) || depotBudgetRequired() && economy.balance < quote.cost)
            return { ok: false, reason: 'Fonds insuffisants.' };
        if (economy.addExpense(quote.cost, 'maintenance', `Fin immédiate ${op.label} — ${op.rameName}`) !== true)
            return { ok: false, reason: 'Paiement refusé.' };
        depot.utilityTotals.expenseEur += quote.cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Fin immédiate — ${op.label}`, amount: quote.cost, category: 'maintenance' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        // The regular completion path applies maintenance effects and releases
        // physical track and staff reservations. Other operations are unchanged.
        op.remainingMin = 0;
        this.updateDepotOperations(0, rameManager, staffManager);
        return { ok: true, cost: quote.cost };
    }
    getOperationsForDepot(depotId) { return this.depotOperations.filter((o) => o.depotId === String(depotId || '')); }
    // Add a rescue loco to a depot — max 2 per depot (Annexe 9)
    addRescueLoco(depotId, stockId, stockName, traction) {
        const depot = this.depots.find((d) => d.id === depotId);
        if (depot?.built && depot.type === 'depot' && stockId) {
            if (depot.rescueLocos.length >= 2 || depot.rescueLocos.some((r) => r.stockId === stockId) || this.depots.some((d) => d.id !== depotId && d.rescueLocos?.some((raw) => raw?.stockId === stockId)))
                return false;
            depot.rescueLocos.push({ stockId: stockId, stockName: stockName, traction: (traction || ''), deployed: false });
            return true;
        }
        return false;
    }
    // Remove a rescue loco from a depot
    removeRescueLoco(depotId, stockId) {
        const depot = this.depots.find((d) => d.id === depotId);
        if (!depot)
            return false;
        const loco = depot.rescueLocos.find((r) => r.stockId === stockId);
        if (!loco || loco.deployed || this.activeRescues.some((r) => r.depotId === depotId && r.stockId === stockId))
            return false;
        depot.rescueLocos = depot.rescueLocos.filter((r) => r.stockId !== stockId);
        return true;
    }
    // Find nearest depot that can rescue
    findNearestRescueDepot(world, lat, lon) {
        let best = null, bestDist = Infinity;
        for (const depot of this.depots) {
            if (!depot.canRescue())
                continue;
            const station = world.getStationById(depot.stationId);
            const origin = depot.location && Number.isFinite(Number(depot.location.lat)) && Number.isFinite(Number(depot.location.lon)) ? depot.location : station;
            if (!origin)
                continue;
            const dLat = (origin.lat - lat) * 111;
            const dLon = (origin.lon - lon) * 111 * Math.cos(lat * Math.PI / 180);
            const dist = Math.sqrt(dLat * dLat + dLon * dLon);
            if (dist < bestDist) {
                bestDist = dist;
                best = depot;
            }
        }
        return best;
    }
    // Dispatch rescue for a broken-down train
    // DDS-02 : choisir un secours diesel si le tronçon est non électrifié, électrique sinon
    dispatchRescue(world, brokenService) {
        const targetId = String(brokenService?.id ?? '');
        const targetPosition = rescuePoint(brokenService?.position);
        if (!targetId || !targetPosition)
            return null;
        // The incident and breakdown paths may request the same rescue in one tick.
        // A restored service may also have lost its transient 'dispatched' flag.
        const existing = this.activeRescues.find(r => r.targetServiceId === targetId && r.state !== 'done');
        if (existing)
            return existing;
        if (this.repairQueue.some(r => r.serviceId === targetId))
            return null;
        const depot = this.findNearestRescueDepot(world, targetPosition.lat, targetPosition.lon);
        if (!depot)
            return null;
        let preferred = '';
        const route = ((typeof brokenService.getCurrentRoute === 'function' && brokenService.getCurrentRoute()) ||
            brokenService._state?.cachedRoute || []);
        if (route?.length > 1) {
            const electCount = route.filter((p) => p.electrified !== false).length;
            const nonElectCount = route.filter((p) => p.electrified === false).length;
            if (nonElectCount > electCount)
                preferred = 'diesel';
            else if (electCount > 0)
                preferred = 'kv';
        }
        const loco = depot.getAvailableRescueLoco(preferred);
        if (!loco)
            return null;
        const station = world.getStationById(depot.stationId);
        const depotOrigin = depot.location && Number.isFinite(Number(depot.location.lat)) && Number.isFinite(Number(depot.location.lon)) ? depot.location : station;
        if (!rescuePoint(depotOrigin) || !depot.deployRescue(loco.stockId))
            return null;
        const repairType = (brokenService?.train?.breakdown?.type || 'moteur');
        const diagnosed = brokenService?.train?.breakdown || {};
        const targetComponent = REPAIR_COMPONENT_BY_BREAKDOWN[repairType] === diagnosed.component ? String(diagnosed.component) : '';
        const targetVehicleId = targetComponent ? String(diagnosed.vehicleId || '') : '';
        const rescue = {
            id: `rescue-${nextRescueId++}`,
            depotId: depot.id,
            stockId: loco.stockId,
            stockName: loco.stockName,
            targetServiceId: targetId,
            repairType,
            targetVehicleId, targetComponent,
            state: 'routing', // routing -> en_route -> recovering -> routing_return -> returning
            position: depotOrigin ? { lat: depotOrigin.lat, lon: depotOrigin.lon } : null,
            targetPosition,
            depotPosition: depotOrigin ? { lat: depotOrigin.lat, lon: depotOrigin.lon } : null,
            speed: 0,
            progress: 0,
            route: null,
            routeIndex: 0,
            returnRoute: null,
            _routeRequestInFlight: false,
            _routeRetrySec: 0,
        };
        // Railway rescue movements are fail-closed: no synthetic straight-line
        // fallback and no implicit reversal of the outbound railway path.
        this.activeRescues.push(rescue);
        this._requestRescueRoute(rescue, rescue.position, targetPosition, false);
        return rescue;
    }
    _requestRescueRoute(rescue, from, to, returning = false) {
        const origin = rescuePoint(from), target = rescuePoint(to);
        if (!rescue || !this.activeRescues.includes(rescue) || rescue._routeRequestInFlight || rescue._routeAccessDenied || !origin || !target)
            return false;
        if (Number(rescue._routeRetryAtMs || 0) > Date.now())
            return false;
        const phase = returning ? 'routing_return' : 'routing';
        rescue.state = phase;
        rescue.speed = 0;
        const current = () => this.activeRescues.includes(rescue) && rescue.state === phase;
        const fail = (error) => {
            if (!current())
                return;
            const f = rescueRouteFailure(error, Number(rescue._routeFailureCount || 0));
            rescue._routeFailureCount = f.attempts;
            rescue._routeRetrySec = f.retrySec;
            rescue._routeRetryAtMs = f.retryAtMs;
            rescue._routeAccessDenied = f.accessDenied;
            rescue.routeStatusMessage = f.message;
        };
        const orm = globalThis.window?.game?.orm;
        if (!orm?.findRoute) {
            fail('Service de routage indisponible');
            return false;
        }
        rescue._routeRequestInFlight = true;
        rescue.routeStatusMessage = 'Recherche du tracé ferroviaire';
        // Start inside a promise so a synchronous provider exception cannot leak the
        // deployed locomotive or abort the game's movement loop.
        Promise.resolve().then(() => current() ? orm.findRoute(origin.lat, origin.lon, target.lat, target.lon) : null)
            .then((raw) => {
            if (!current())
                return;
            const route = validatedRescueRoute(raw, origin, target);
            if (!route) {
                fail('Tracé refusé : géométrie ou extrémités incohérentes');
                return;
            }
            const liveService = !returning ? globalThis.window?.game?.scheduleCreator?.services?.find((s) => s.id === rescue.targetServiceId) : null;
            const liveTarget = rescuePoint(liveService?.position);
            const movedOrigin = rescuePoint(rescue.position);
            const movedTarget = rescuePoint(rescue.targetPosition);
            if (!movedOrigin || !movedTarget || rescueDistanceKm(origin, movedOrigin) > RESCUE_ENDPOINT_TOLERANCE_KM || rescueDistanceKm(target, movedTarget) > RESCUE_ENDPOINT_TOLERANCE_KM || (liveTarget && rescueDistanceKm(target, liveTarget) > RESCUE_ENDPOINT_TOLERANCE_KM)) {
                if (liveTarget)
                    rescue.targetPosition = liveTarget;
                fail('Position modifiée pendant le calcul : tracé à recalculer');
                return;
            }
            if (returning)
                rescue.returnRoute = route;
            else
                rescue.route = route;
            rescue.routeIndex = 0;
            rescue._routeRetrySec = 0;
            rescue._routeRetryAtMs = 0;
            rescue._routeFailureCount = 0;
            rescue.routeStatusMessage = '';
            rescue.state = returning ? 'returning' : 'en_route';
        }).catch(fail).finally(() => { rescue._routeRequestInFlight = false; });
        return true;
    }
    resumeRescueRouting(id) {
        const rescue = this.activeRescues.find(r => r.id === String(id));
        if (!rescue || !['routing', 'routing_return'].includes(rescue.state) || rescue._routeRequestInFlight || Number(rescue._routeRetryAtMs || 0) > Date.now())
            return false;
        rescue._routeAccessDenied = false;
        rescue._routeRetrySec = 0;
        rescue._routeRetryAtMs = 0;
        return !!rescue.targetPosition && this._requestRescueRoute(rescue, rescue.position, rescue.targetPosition, rescue.state === 'routing_return');
    }
    /** The mission, not a transient train flag, owns an attached consist. */
    hasRescuedOccurrence(serviceId) { return this.rescuedOccurrenceIds.has(String(serviceId)); }
    ownsServiceMovement(serviceId) {
        return this.activeRescues.some(r => r.targetServiceId === String(serviceId) && r.towAttached === true && r.state !== 'done');
    }
    isVehicleUnderRepair(vehicleId) {
        return this.repairQueue.some(q => q.vehicleIds?.includes(String(vehicleId)));
    }
    getRescuedFormations(depotId) {
        return this.rescuedFormations.filter(f => f.depotId === String(depotId)).map(f => ({ ...f, vehicleIds: [...f.vehicleIds], repairing: this.repairQueue.some(q => q.serviceId === f.serviceId) }));
    }
    reconcileRescuedFormations() {
        const rotation = globalThis.window?.game?.rotationV2;
        if (!rotation?.getVehicle)
            return;
        this.rescuedFormations = this.rescuedFormations.filter(f => {
            if (this.repairQueue.some(q => q.serviceId === f.serviceId))
                return true;
            // A physical-only formation is a parking record, NOT another purchased rame.
            // Keep its bay until every known member has actually left this depot.
            const left = f.vehicleIds.length > 0 && f.vehicleIds.every(id => {
                const v = rotation.getVehicle(id);
                return !!v?.location?.id && !(v.location.kind === 'DEPOT' && v.location.id === f.depotId);
            });
            if (!left)
                return true;
            const slot = this.getDepotById(f.depotId)?.findRameTrack(f.id);
            if (slot) {
                slot.rameId = '';
                slot.purpose = 'garage';
                slot.operationId = '';
            }
            return false;
        });
    }
    restoreRescueTow(serviceId) {
        const rescue = this.activeRescues.find(r => r.targetServiceId === String(serviceId) && r.towAttached === true && r.state !== 'done');
        return !!rescue && this._syncRescueTow(rescue, 0);
    }
    /** Only a genuine stopped rendezvous target can share a block with its
     * rescue. A third train is NEVER part of this authorisation. */
    isRescueCouplingAuthorized(a, b) {
        const r = this.activeRescues.find(r => (r.id === a && r.targetServiceId === b) || (r.id === b && r.targetServiceId === a));
        if (!r || r.state === 'done' || !r.position)
            return false;
        const target = this._rescueTarget(r);
        if (!target?.position || target.cancelled || target.completed)
            return false;
        if (r.towAttached)
            return rescueDistanceKm(r.position, target.position) <= RESCUE_ENDPOINT_TOLERANCE_KM;
        return ['en_route', 'recovering'].includes(r.state) && Math.abs(Number(target.speed || 0)) <= .01
            && !!r.targetPosition && rescueDistanceKm(target.position, r.targetPosition) <= .001
            && rescueDistanceKm(r.position, target.position) <= 2;
    }
    getPhysicalRescueService(id) { return this.getPhysicalRescueServices().find(s => s.id === String(id)); }
    /** Occupation liveness remains true during load, before controllers exist. */
    hasPhysicalRescue(id) { return this.activeRescues.some(r => r.id === String(id) && r.state !== 'done' && !!r.position) || this.physicalOperations.some(op => op.id === String(id) && op.state !== 'done' && !!op.position); }
    getPhysicalRescueServices() {
        for (const rescue of this.activeRescues)
            this._prepareRescueMovement(rescue);
        this.reconcilePhysicalReservations();
        for (const op of this.physicalOperations)
            this._prepareDepotMovement(op);
        return [...new Map([...this._rescueMovements.values()].filter(s => this.activeRescues.some(r => r.id === s.id && r.state !== 'done')).concat([...this._depotMovements.values()].filter(s => this.physicalOperations.some(op => op.id === s.id && op.state !== 'done'))).map(s => [s.id, s])).values()];
    }
    _prepareRescueMovement(rescue) {
        const game = globalThis.window?.game;
        if (rescue._motionInvalid) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Secours suspendu : état physique sauvegardé invalide';
            return null;
        }
        const returning = rescue.state === 'returning' || rescue.state === 'routing_return' && rescue.towAttached === true;
        const route = returning ? rescue.returnRoute : rescue.route;
        let controller = this._rescueMovements.get(rescue.id);
        if (!route || route.length < 2 || !rescue.position || !game)
            return controller || null;
        if (!controller) {
            const rames = game.rameManager?.getAll?.() || [];
            const parent = rames.find(r => r.elementDetails?.some(e => e.elementId === rescue.stockId));
            const detail = parent?.elementDetails.find(e => e.elementId === rescue.stockId) || game.rollingStock?.getById?.(rescue.stockId);
            if (!detail || !(Number(detail.power) > 0) || !(Number(detail.mass || detail.tonnage) > 0) || !(Number(detail.length) > 0) || !(Number(detail.maxSpeed) > 0)) {
                rescue.speed = 0;
                rescue.routeStatusMessage = 'Secours retenu : caractéristiques physiques du matériel manquantes';
                return null;
            }
            const registered = this.getDepotById(rescue.depotId)?.rescueLocos.find(l => l.stockId === rescue.stockId);
            const material = new Rame({ id: rescue.id + ':material', name: rescue.stockName, elementDetails: [{ ...detail, category: 'locomotive' }], consumables: rescue.movementSnapshot?.consumables || registered?.consumables || parent?.consumables,
                totalKmRun: Number(registered?.totalKmRun || 0) });
            controller = new RescueMovement(rescue.id, material, game.world, game.weather);
            // Register before initializing occupations so cleanup can resolve its owner.
            this._rescueMovements.set(rescue.id, controller);
        }
        if (controller.routeIdentity !== route || controller.returning !== returning) {
            const snapshot = rescue.movementSnapshot?.returning === returning ? rescue.movementSnapshot : undefined;
            if (rescue.route)
                cantonManager.createRouteCantons(rescue.route);
            const target = this._rescueTarget(rescue);
            if (target?.getCurrentRoute?.())
                cantonManager.createRouteCantons(target.getCurrentRoute());
            controller.configure(route, rescue.position, returning, target, snapshot);
            if (!snapshot)
                controller.speed = Math.max(0, Number(rescue.speed) || 0);
            controller._economy = game.economy;
            controller._currentDate = game._currentDate || target?._currentDate || '';
            if (returning && target) {
                const retained = cantonManager.transferTrainResources(target.id, controller.id);
                controller._carryoverCantonIds = new Set([...(controller._carryoverCantonIds || []), ...retained]);
                if (!snapshot)
                    controller._carryoverStartTravelKm = controller.totalDistance;
                for (const trc of game.voiePointManager?.troncons || []) {
                    if (trc.occupiedBy === target.id) {
                        trc.occupiedBy = controller.id;
                        controller._occupiedTronconIds.add(trc.id);
                        controller._tronconExitTravelKm.set(trc.id, controller.totalDistance);
                    }
                    if (trc.reservedBy === target.id)
                        trc.reservedBy = controller.id;
                }
                controller._syncCantonFootprint(route);
            }
        }
        return controller;
    }
    _moveRescue(rescue, dt, timeOfDay, fleet) {
        const controller = this._prepareRescueMovement(rescue);
        if (!controller)
            return false;
        const returning = rescue.state === 'returning';
        if (returning && !rescue.towAttached)
            return false;
        controller._currentDate = globalThis.window?.game?._currentDate || controller._currentDate;
        const distance = rescue.targetPosition && rescue.position ? rescueDistanceKm(rescue.position, rescue.targetPosition) : Infinity;
        controller.setPhaseLimit(returning ? 60 : distance < .5 ? 10 : distance < 2 ? 30 : 100);
        const before = controller.totalDistance;
        if (controller.arrived) {
            rescue.speed = 0;
        }
        else {
            // The engine already uses 100 ms. Direct calls/tests also use the same
            // bounded physical step; no fast path bypasses the shared constraints.
            let remaining = dt;
            while (remaining > 1e-9 && !controller.arrived) {
                const step = Math.min(.1, remaining);
                controller.moveUpdate(step, timeOfDay + (dt - remaining) / 60, fleet);
                remaining -= step;
            }
            rescue.position = controller.position ? { ...controller.position } : rescue.position;
            rescue.speed = controller.speed;
            rescue.routeIndex = controller._state.index;
            rescue.routeStatusMessage = controller.train.delayReason || '';
        }
        rescue.movementSnapshot = controller.snapshot();
        // The locomotive's fuel and odometer belong to the depot roster, not to
        // a disposable mission controller. A second dispatch cannot refill it.
        const registered = this.getDepotById(rescue.depotId)?.rescueLocos.find(l => l.stockId === rescue.stockId);
        if (registered && controller.rame) {
            registered.consumables = { ...controller.rame.consumables };
            registered.totalKmRun = Number(controller.rame.totalKmRun || 0);
        }
        if (returning) {
            if (!this._syncRescueTow(rescue, Math.max(0, controller.totalDistance - before)))
                return false;
            if (controller.arrived) {
                if (this._deliverRescueTow(rescue)) {
                    controller._releaseAllPhysicalResources();
                    this._rescueMovements.delete(rescue.id);
                }
            }
        }
        else if (controller.arrived) {
            const target = this._rescueTarget(rescue);
            if (!target?.position || !rescue.position || rescueDistanceKm(rescue.position, target.position) > RESCUE_ENDPOINT_TOLERANCE_KM) {
                rescue.state = 'routing';
                rescue.route = null;
                rescue.speed = 0;
                rescue.routeIndex = 0;
                rescue.routeStatusMessage = 'Le train cible a bougé : nouveau tracé requis';
            }
            else {
                rescue.state = 'recovering';
                rescue.speed = 0;
                rescue._recoverTimer = 5;
            }
        }
        return true;
    }
    _rescueTarget(rescue) {
        return globalThis.window?.game?.scheduleCreator?.services?.find((s) => String(s.id) === rescue.targetServiceId) || null;
    }
    _attachRescueTow(rescue) {
        const target = this._rescueTarget(rescue);
        const position = rescuePoint(target?.position);
        if (!target?.train || !position || !rescue.position) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Prise en charge suspendue : train cible absent';
            return false;
        }
        if (rescueDistanceKm(rescue.position, position) > RESCUE_ENDPOINT_TOLERANCE_KM ||
            Math.abs(Number(target.speed ?? target.train.speed ?? 0)) > 0.01) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Prise en charge suspendue : train cible non immobilisé à l’accostage';
            return false;
        }
        rescue.towAttached = true;
        rescue.towDistanceKm = Math.max(0, Number(rescue.towDistanceKm) || 0);
        rescue.towRameId = String(target._v2DirectRameId || target._v2AssignedRameId || target.rame?.id || target.rameId || '');
        rescue.towVehicleIds = Array.isArray(target._v2VehicleIds) ? target._v2VehicleIds.map(String) : [];
        target.speed = target.train.speed = 0;
        target.train.state = 'pris en charge';
        target.train.delayReason = 'Secours attelé — attente du tracé de retour';
        target._movementStop?.('RESCUE_TOW', target.train.delayReason, 'depot');
        return true;
    }
    /** Restore/publish the consist on the SAME resolved return path. Coordinates
     * are the convoy's common map reference, not independently modelled couplers.
     * The original timetable never advances, earns revenue or consumes traction.
     */
    _syncRescueTow(rescue, movedKm = 0) {
        const target = this._rescueTarget(rescue);
        if (!rescue.towAttached || !target?.train || !rescue.position) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Remorquage suspendu : train cible indisponible';
            return false;
        }
        const game = globalThis.window?.game;
        const material = game?.rameManager?.getById?.(rescue.towRameId) || target.rame;
        if (!material || material.currentLocation?.depotId) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Remorquage suspendu : matériel absent ou déjà localisé dans un dépôt';
            return false;
        }
        target.position = { ...rescue.position };
        target.speed = Number(rescue.speed) || 0;
        target.train.speed = Math.round(target.speed);
        target.state = 'moving';
        target.train.state = 'remorqué';
        target.train.delayReason = rescue.routeStatusMessage || 'Acheminement au dépôt par le secours';
        target.train.stoppedAt = null;
        target._movementStop?.('RESCUE_TOW', 'Traction propre neutralisée : remorquage', 'depot');
        const route = rescue.returnRoute;
        if (route && route.length >= 2 && target._state) {
            if (target._state.cachedRoute !== route) {
                target._captureCantonCarryover?.();
                target._initializeState?.(route, `rescue:${rescue.id}`);
            }
            if (target._state.cachedRoute === route) {
                target._state.index = Math.min(rescue.routeIndex, route.length - 1);
                const from = route[target._state.index], to = route[target._state.index + 1];
                const length = to ? rescueDistanceKm(from, to) : 0;
                target._state.progress = length > 0 ? Math.min(1, rescueDistanceKm(from, rescue.position) / length) : 0;
                if (!this._rescueMovements.has(rescue.id))
                    target._syncCantonFootprint?.(route);
                target._releaseDepartureResourcesIfTailClear?.(route);
            }
        }
        if (movedKm > 0 && Number.isFinite(movedKm)) {
            rescue.towDistanceKm = (Number(rescue.towDistanceKm) || 0) + movedKm;
            // Service accounting excludes the rescue diversion; material odometers do not.
            advanceMaterialMileage(material, target.train, movedKm);
            if (material && target.rame && material !== target.rame) {
                for (const key of ['totalKmRun', 'kmSinceLastMaint', 'wearLevel'])
                    target.rame[key] = material[key];
            }
            for (const id of rescue.towVehicleIds || []) {
                const v = game?.rotationV2?.getVehicle?.(id);
                if (v)
                    v.odometerKm = Math.max(0, Number(v.odometerKm) || 0) + movedKm;
            }
        }
        if (material)
            material.currentLocation = { depotId: '', stationId: '', serviceId: target.id, lat: rescue.position.lat, lon: rescue.position.lon };
        target._movementStop?.('RESCUE_TOW', 'Traction propre neutralisée : remorquage', 'depot');
        return true;
    }
    _deliverRescueTow(rescue) {
        const target = this._rescueTarget(rescue), game = globalThis.window?.game;
        const depot = this.getDepotById(rescue.depotId);
        const material = game?.rameManager?.getById?.(rescue.towRameId) || target?.rame;
        if (!rescue.towAttached || !target?.train || !depot?.built || !rescue.position || !rescue.depotPosition ||
            rescueDistanceKm(rescue.position, rescue.depotPosition) > RESCUE_ENDPOINT_TOLERANCE_KM) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Réception au dépôt suspendue : convoi ou dépôt indisponible';
            return false;
        }
        if (!material || (rescue.towVehicleIds || []).some(id => !game?.rotationV2?.getVehicle?.(id))) {
            rescue.speed = 0;
            rescue.routeStatusMessage = 'Réception suspendue : matériel introuvable';
            return false;
        }
        // Do not mark the mission done, free its locomotive, or start repairing while
        // depot admission can still fail. The whole consist remains at the endpoint.
        if (material) {
            const result = this.enterRame(depot.id, material, []);
            if (!result.ok) {
                rescue.speed = target.speed = target.train.speed = 0;
                rescue.routeStatusMessage = result.reason || 'Dépôt indisponible';
                return false;
            }
            material.currentLocation = { ...material.currentLocation, lat: rescue.depotPosition.lat, lon: rescue.depotPosition.lon };
            material.inMaintenance = true;
            if (target.rame && target.rame !== material) {
                target.rame.currentLocation = { ...material.currentLocation };
                target.rame.inMaintenance = true;
            }
        }
        if ((rescue.towVehicleIds || []).length && !game?.rameManager?.getById?.(rescue.towRameId) && !this.rescuedFormations.some(f => f.serviceId === target.id)) {
            this.rescuedFormations.push({ id: material.id, name: String(material.name || target.name || target.id), depotId: depot.id, serviceId: target.id, vehicleIds: [...(rescue.towVehicleIds || [])] });
        }
        for (const id of rescue.towVehicleIds || []) {
            const v = game?.rotationV2?.getVehicle?.(id);
            if (v) {
                v.available = false;
                v.location = { kind: 'DEPOT', id: depot.id, depotId: depot.id, lat: rescue.depotPosition.lat, lon: rescue.depotPosition.lon };
            }
        }
        target._releaseAllPhysicalResources?.();
        target._finishLegacyOperatingDay?.();
        target.speed = target.train.speed = 0;
        target.completed = true;
        target.cancelled = true;
        target.state = 'cancelled';
        target.train.inDepot = true;
        target.train.inMaintenance = true;
        target.train.state = 'au dépôt';
        target.train.delayReason = 'Service interrompu — rame remorquée au dépôt';
        target.train.stoppedAt = null;
        target.position = null;
        // This mission has already committed physical material placement; normal V2
        // finalization must not move it to a booked stop or free broken vehicles.
        if (target._v2OccurrenceId) {
            target._v2MaterialFinalized = true;
            this.rescuedOccurrenceIds.add(target.id);
        }
        if (!this.repairQueue.some(q => q.serviceId === rescue.targetServiceId))
            this.repairQueue.push({
                serviceId: rescue.targetServiceId, depotId: rescue.depotId, rameId: rescue.towRameId,
                vehicleIds: (rescue.towVehicleIds || []).length ? [...rescue.towVehicleIds]
                    : (material.elementDetails || []).map((detail, index) => String(detail.physicalVehicleId || `${material.id}:${detail.instanceId || index}`)),
                remainingMin: 30, totalMin: 30,
                serviceName: String(target.name || target.id), repairType: rescue.repairType || 'moteur',
                targetVehicleId: rescue.targetVehicleId || '', targetComponent: rescue.targetComponent || '',
            });
        rescue.state = 'done';
        rescue.speed = 0;
        depot.returnRescue(rescue.stockId);
        game?.scheduleCreator?._invalidateActiveCache?.();
        return true;
    }
    // Update active rescues (called each move tick)
    updateRescues(dt, timeOfDay = Number(globalThis.window?.game?.timeOfDay || 0), physicalFleet) {
        if (!Number.isFinite(dt) || dt <= 0)
            return;
        this.reconcileRescuedFormations();
        const fleet = physicalFleet || [...(globalThis.window?.game?.scheduleCreator?.services || []).filter((s) => !this.ownsServiceMovement(s.id)), ...this.getPhysicalRescueServices()];
        for (const rescue of this.activeRescues) {
            if (!rescue.position || !rescue.targetPosition)
                continue;
            if (rescue.state === 'routing' || rescue.state === 'routing_return') {
                rescue.speed = 0;
                rescue._routeRetrySec = Math.max(0, Number(rescue._routeRetrySec || 0) - Number(dt || 0));
                if (!rescue._routeAccessDenied && !rescue._routeRequestInFlight && rescue._routeRetrySec <= 0 && Number(rescue._routeRetryAtMs || 0) <= Date.now()) {
                    const liveService = rescue.state === 'routing' ? globalThis.window?.game?.scheduleCreator?.services?.find((s) => s.id === rescue.targetServiceId) : null;
                    const liveTarget = rescuePoint(liveService?.position);
                    if (liveTarget)
                        rescue.targetPosition = liveTarget;
                    this._requestRescueRoute(rescue, rescue.position, rescue.targetPosition, rescue.state === 'routing_return');
                }
                continue;
            }
            if (rescue.state === 'en_route') {
                const actualTarget = rescuePoint(this._rescueTarget(rescue)?.position);
                if (actualTarget && rescueDistanceKm(actualTarget, rescue.targetPosition) > RESCUE_ENDPOINT_TOLERANCE_KM) {
                    rescue.targetPosition = actualTarget;
                    rescue.state = 'routing';
                    rescue.route = null;
                    rescue.speed = 0;
                    rescue.routeIndex = 0;
                    rescue.movementSnapshot = undefined;
                    const old = this._rescueMovements.get(rescue.id);
                    if (old) {
                        old.speed = old.train.speed = 0;
                    }
                    rescue.routeStatusMessage = 'Train cible déplacé : recalcul du trajet depuis la position réelle';
                    continue;
                }
                if (!rescue.route || rescue.route.length < 2) {
                    rescue.state = 'routing';
                    rescue.speed = 0;
                    rescue._routeRetrySec = 0;
                    continue;
                }
                this._moveRescue(rescue, dt, timeOfDay, fleet);
            }
            else if (rescue.state === 'recovering') {
                const target = globalThis.window?.game?.scheduleCreator?.services?.find((s) => s.id === rescue.targetServiceId);
                const position = rescuePoint(target?.position);
                if (position && rescueDistanceKm(rescue.position, position) > RESCUE_ENDPOINT_TOLERANCE_KM) {
                    rescue.targetPosition = position;
                    rescue.state = 'routing';
                    rescue.speed = 0;
                    rescue.route = null;
                    rescue.routeIndex = 0;
                    rescue._recoverTimer = 5;
                    rescue.routeStatusMessage = 'Accostage interrompu : le train cible a bougé';
                    continue;
                }
                // dt is in seconds; _recoverTimer is in minutes
                rescue._recoverTimer = (Number.isFinite(rescue._recoverTimer) ? rescue._recoverTimer : 5) - dt / 60;
                if (rescue._recoverTimer <= 0) {
                    if (!this._attachRescueTow(rescue))
                        continue;
                    rescue.targetPosition = rescue.depotPosition;
                    rescue.speed = 0;
                    rescue.returnRoute = null;
                    rescue.routeIndex = 0;
                    rescue.state = 'routing_return';
                    this._requestRescueRoute(rescue, rescue.position, rescue.depotPosition, true);
                }
            }
            else if (rescue.state === 'returning') {
                if (!rescue.towAttached) {
                    // RC14 saved returns did not actually carry the target. Never teleport
                    // that train to a returning locomotive during migration.
                    const target = rescuePoint(this._rescueTarget(rescue)?.position);
                    rescue.speed = 0;
                    if (target) {
                        rescue.targetPosition = target;
                        rescue.state = 'routing';
                        rescue.route = null;
                        rescue.returnRoute = null;
                        rescue.routeIndex = 0;
                        rescue._routeRetrySec = 0;
                        rescue.routeStatusMessage = 'Ancien retour sans train : reprise du secours à la position réelle';
                    }
                    else
                        rescue.routeStatusMessage = 'Ancien retour suspendu : train cible absent';
                    continue;
                }
                const towTarget = this._rescueTarget(rescue);
                if (!towTarget?.position || towTarget.cancelled || towTarget.completed || !rescue.depotPosition || !this.getDepotById(rescue.depotId)?.built) {
                    rescue.speed = 0;
                    rescue.routeStatusMessage = 'Remorquage suspendu : train cible ou dépôt absent';
                    continue;
                }
                const towMaterial = globalThis.window?.game?.rameManager?.getById?.(rescue.towRameId) || towTarget.rame;
                if (rescueDistanceKm(rescue.position, towTarget.position) > RESCUE_ENDPOINT_TOLERANCE_KM ||
                    !towMaterial || towMaterial.currentLocation?.depotId ||
                    (rescue.towRameId && String(towTarget._v2DirectRameId || towTarget._v2AssignedRameId || towTarget.rame?.id || '') !== rescue.towRameId)) {
                    rescue.speed = towTarget.speed = towTarget.train.speed = 0;
                    rescue.routeStatusMessage = 'Remorquage suspendu : localisation ou composition du matériel incohérente';
                    continue;
                }
                if (!rescue.returnRoute || rescue.returnRoute.length < 2) {
                    rescue.state = 'routing_return';
                    rescue.speed = 0;
                    rescue._routeRetrySec = 0;
                    continue;
                }
                this._moveRescue(rescue, dt, timeOfDay, fleet);
            }
        }
        // Remove completed rescues
        this.activeRescues = this.activeRescues.filter((r) => r.state !== 'done');
    }
    quoteRepairAcceleration(serviceId) {
        const order = this.repairQueue.find(r => r.serviceId === String(serviceId));
        if (!order)
            return { ok: false, reason: 'Réparation introuvable.' };
        if (order.accelerated || !Number.isFinite(order.remainingMin) || order.remainingMin <= 1)
            return { ok: false, reason: 'Réparation déjà accélérée ou presque terminée.' };
        const depot = this.getDepotById(order.depotId);
        if (!depot || depot.type !== 'depot' || !depot.built)
            return { ok: false, reason: 'Dépôt indisponible.' };
        const keys = { moteur: 'engine_generic', freins: 'brake_pad_set', climatisation: 'hvac_unit', portes: 'door_drive', fanaux: 'headlight_unit' };
        const key = keys[order.repairType];
        if (key && depot.availablePartStock(key) < 1)
            return { ok: false, reason: 'Pièce de réparation manquante.' };
        return { ok: true, cost: Math.round(500 + Math.ceil(order.remainingMin - 1) * 30) };
    }
    accelerateRepair(serviceId, expectedCost, economy) {
        const quote = this.quoteRepairAcceleration(serviceId);
        if (!quote.ok)
            return quote;
        if (!Number.isFinite(Number(expectedCost)) || Number(expectedCost) !== quote.cost)
            return { ok: false, reason: 'Le devis a changé : réessayez.' };
        if (!economy || !Number.isFinite(Number(economy.balance)) || depotBudgetRequired() && economy.balance < quote.cost)
            return { ok: false, reason: 'Fonds insuffisants.' };
        const order = this.repairQueue.find(r => r.serviceId === String(serviceId));
        const depot = this.getDepotById(order.depotId);
        const needed = { moteur: 'engine_generic', freins: 'brake_pad_set', climatisation: 'hvac_unit', portes: 'door_drive', fanaux: 'headlight_unit' };
        const part = needed[order.repairType];
        // Reserve the real part now. Another repair may otherwise consume it before
        // the next tick and strand a paid expedite indefinitely.
        if (part && !depot.consumeParts({ [part]: 1 }))
            return { ok: false, reason: 'Pièce de réparation manquante.' };
        let charged = false;
        try {
            charged = economy.addExpense(quote.cost, 'entretien', `Accélération réparation ${order.serviceName}`) === true;
        }
        catch (error) {
            if (part)
                depot.addPart(part, 1);
            throw error;
        }
        if (!charged) {
            if (part)
                depot.addPart(part, 1);
            return { ok: false, reason: 'Paiement refusé.' };
        }
        // The ordinary tick still checks parts and performs the rescue completion.
        // A paid shortcut can never repair a train without those prerequisites.
        order.remainingMin = 1;
        order.accelerated = true;
        order.partsReserved = !!part;
        return { ok: true, cost: quote.cost };
    }
    quoteRepairImmediate(serviceId) {
        const order = this.repairQueue.find(r => r.serviceId === String(serviceId));
        if (!order || !Number.isFinite(order.remainingMin) || order.remainingMin <= 0)
            return { ok: false, reason: 'Réparation introuvable ou terminée.' };
        const depot = this.getDepotById(order.depotId);
        if (!depot || depot.type !== 'depot' || !depot.built)
            return { ok: false, reason: 'Dépôt indisponible.' };
        const keys = { moteur: 'engine_generic', freins: 'brake_pad_set', climatisation: 'hvac_unit', portes: 'door_drive', fanaux: 'headlight_unit' };
        const key = keys[order.repairType];
        if (key && !order.partsReserved && depot.availablePartStock(key) < 1)
            return { ok: false, reason: 'Pièce de réparation manquante.' };
        return { ok: true, cost: Math.round(500 + Math.ceil(order.remainingMin) * 30) };
    }
    finishRepairNow(serviceId, expectedCost, economy) {
        const quote = this.quoteRepairImmediate(serviceId);
        if (!quote.ok)
            return quote;
        if (!Number.isFinite(Number(expectedCost)) || Number(expectedCost) !== quote.cost)
            return { ok: false, reason: 'Le devis a changé : réessayez.' };
        if (!economy || !Number.isFinite(Number(economy.balance)) || depotBudgetRequired() && economy.balance < quote.cost)
            return { ok: false, reason: 'Fonds insuffisants.' };
        const order = this.repairQueue.find(r => r.serviceId === String(serviceId));
        const depot = this.getDepotById(order.depotId);
        const keys = { moteur: 'engine_generic', freins: 'brake_pad_set', climatisation: 'hvac_unit', portes: 'door_drive', fanaux: 'headlight_unit' };
        const part = keys[order.repairType];
        const reservedPart = !!order.partsReserved;
        if (part && !reservedPart && !depot.consumeParts({ [part]: 1 }))
            return { ok: false, reason: 'Pièce de réparation manquante.' };
        let charged = false;
        try {
            charged = economy.addExpense(quote.cost, 'entretien', `Fin immédiate réparation ${order.serviceName}`) === true;
        }
        catch (error) {
            if (part && !reservedPart)
                depot.addPart(part, 1);
            throw error;
        }
        if (!charged) {
            if (part && !reservedPart)
                depot.addPart(part, 1);
            return { ok: false, reason: 'Paiement refusé.' };
        }
        depot.utilityTotals.expenseEur += quote.cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Fin immédiate réparation — ${order.serviceName}`, amount: quote.cost, category: 'maintenance' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        order.partsReserved = !!part;
        order.accelerated = true;
        order.remainingMin = 0;
        const completed = this.updateRepairs(0);
        return { ok: true, cost: quote.cost, ...completed };
    }
    quoteMaintenanceImmediate(rameId) {
        const order = this.maintenanceQueue.find(m => m.rameId === String(rameId));
        if (!order || !Number.isFinite(order.remainingMin) || order.remainingMin <= 0)
            return { ok: false, reason: 'Entretien introuvable ou déjà terminé.' };
        const depot = this.getDepotById(order.depotId);
        if (!depot || depot.type !== 'depot' || !depot.built)
            return { ok: false, reason: 'Dépôt indisponible.' };
        return { ok: true, cost: Math.round(500 + Math.ceil(order.remainingMin) * 30) };
    }
    finishMaintenanceNow(rameId, expectedCost, economy, rameManager) {
        const quote = this.quoteMaintenanceImmediate(rameId);
        if (!quote.ok)
            return quote;
        if (!Number.isFinite(Number(expectedCost)) || Number(expectedCost) !== quote.cost)
            return { ok: false, reason: 'Le devis a changé : réessayez.' };
        const order = this.maintenanceQueue.find(m => m.rameId === String(rameId));
        const rame = rameManager?.getById?.(order.rameId);
        if (!rame)
            return { ok: false, reason: 'Rame indisponible : impossible de terminer cet entretien.' };
        if (!economy || !Number.isFinite(Number(economy.balance)) || depotBudgetRequired() && economy.balance < quote.cost)
            return { ok: false, reason: 'Fonds insuffisants.' };
        if (economy.addExpense(quote.cost, 'maintenance', `Fin immédiate entretien ${order.rameName}`) !== true)
            return { ok: false, reason: 'Paiement refusé.' };
        const depot = this.getDepotById(order.depotId);
        depot.utilityTotals.expenseEur += quote.cost;
        depot.expenseLedger.push({ time: Date.now(), label: `Fin immédiate entretien — ${order.rameName}`, amount: quote.cost, category: 'maintenance' });
        depot.expenseLedger = depot.expenseLedger.slice(-120);
        order.remainingMin = 0;
        const completed = this.updateRepairs(0);
        return { ok: true, cost: quote.cost, ...completed };
    }
    // Update repair & maintenance timers (called each minute tick)
    updateRepairs(dt) {
        const rawStep = Number(dt);
        const step = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 1; // preserve an explicit dt=0 on load/initialisation
        for (const order of this.supplyOrders)
            order.remainingMin -= step;
        for (const order of this.supplyOrders.filter(o => o.remainingMin <= 0)) {
            const depot = this.getDepotById(order.depotId);
            if (!depot || !depot.built || depot.type !== 'depot')
                continue;
            if (order.kind === 'part')
                depot.addPart(order.key, order.qty);
            else
                depot.resourceStocks[order.key] = Math.min(Number(depot.resourceCapacities[order.key] || 0), Number(depot.resourceStocks[order.key] || 0) + order.qty);
        }
        this.supplyOrders = this.supplyOrders.filter(o => o.remainingMin > 0);
        const finished = [];
        for (const r of this.repairQueue) {
            r.remainingMin -= step;
            if (r.remainingMin <= 0)
                finished.push(r);
        }
        for (const r of finished) {
            // Section VI — consommation de pièces détachées pour la réparation
            const depot = this.depots.find((d) => d.id === r.depotId);
            const type = r.repairType || 'moteur';
            const needed = { moteur: 1, freins: 1, climatisation: 1, portes: 1, fanaux: 1 };
            if (!depot || depot.type !== 'depot' || !depot.built) {
                r.remainingMin = 60; // le dépôt a disparu / n'est pas opérationnel : ne jamais réparer magiquement
            }
            else if (needed[type] && !r.partsReserved) {
                depot.consumeSpareParts({ [type]: needed[type] }) || (r.remainingMin = 60); // attendre pièces
            }
            if (r.remainingMin <= 0) {
                if (r.targetVehicleId && r.targetComponent === REPAIR_COMPONENT_BY_BREAKDOWN[type] &&
                    (r.vehicleIds || []).includes(r.targetVehicleId))
                    globalThis.window?.game?.operationalExtensions?.repairComponent?.(r.targetVehicleId, r.targetComponent);
                this.repairQueue = this.repairQueue.filter((q) => q.serviceId !== r.serviceId);
            }
        }
        const finishedM = [];
        for (const m of this.maintenanceQueue) {
            m.remainingMin -= step;
            if (m.remainingMin <= 0)
                finishedM.push(m);
        }
        for (const m of finishedM) {
            this.maintenanceQueue = this.maintenanceQueue.filter((q) => q.rameId !== m.rameId);
        }
        return {
            repaired: finished.filter((r) => r.remainingMin <= 0).map((r) => ({ serviceId: r.serviceId, depotId: r.depotId, repairType: r.repairType, rameId: r.rameId, vehicleIds: [...(r.vehicleIds || [])], targetVehicleId: r.targetVehicleId || '', targetComponent: r.targetComponent || '' })),
            maintainedIds: finishedM.map((m) => m.rameId),
        };
    }
    // MNT-06 : vérification mensuelle de la maintenance préventive recommandée
    checkPreventiveMaintenance(dateStr, rameManager) {
        if (!dateStr || !rameManager)
            return;
        for (const rame of rameManager.getAll()) {
            if (rame.inMaintenance || this.isRameInMaintenance(rame.id)) {
                rame.recommendedMaintenance = false;
                continue;
            }
            rame.recommendedMaintenance = preventiveMaintenanceReasons(rame, dateStr).length > 0;
        }
    }
    // MNT-05 : liste des dépôts avec pièces détachées en sous-stock
    getLowStockDepots(threshold = 2) {
        const result = [];
        for (const depot of this.depots) {
            if (depot.type !== 'depot' || !depot.built)
                continue;
            const low = Object.entries(depot.spareParts || {})
                .filter(([, qty]) => Number(qty) < Number(threshold))
                .map(([type]) => type);
            if (low.length > 0)
                result.push({ depot, low });
        }
        return result;
    }
    // MNT-05 : livraison groupée de pièces détachées vers plusieurs dépôts
    buyBulkSpareParts(type, qty, economy) {
        qty = Number(qty);
        if (!Number.isInteger(qty) || qty <= 0 || !economy)
            return { ok: false, totalCost: 0, invalid: true };
        const prices = { moteur: 5000, freins: 3000, climatisation: 2000, portes: 1500, fanaux: 1000 };
        const partType = String(type || '');
        const price = prices[partType];
        if (!price)
            return { ok: false, totalCost: 0, invalid: true };
        const targets = this.depots.filter((d) => d.type === 'depot' && d.built);
        const totalCost = price * qty * targets.length;
        if (depotBudgetRequired() && economy.balance < totalCost)
            return { ok: false, totalCost };
        if (!targets.length)
            return { ok: false, totalCost: 0, invalid: true };
        if (economy.addExpense(totalCost, 'maintenance', `Commande groupée pièces : ${partType} x${qty} (${targets.length} dépôts)`) !== true)
            return { ok: false, totalCost, reason: 'Paiement refusé.' };
        const legacy = { moteur: 'engine_generic', freins: 'brake_pad_set', climatisation: 'hvac_unit', portes: 'door_drive', fanaux: 'headlight_unit' };
        for (const depot of targets)
            this.supplyOrders.push({ orderId: `supply-${nextDepotSupplyOrderId++}`, depotId: depot.id, kind: 'part', key: legacy[partType] || partType, qty, remainingMin: 120, totalMin: 120, accelerated: false });
        return { ok: true, totalCost, count: targets.length };
    }
    // Send a RAME for preventive maintenance
    sendRameToMaintenance(rameId, rameName, depotId) {
        rameId = String(rameId ?? '');
        depotId = String(depotId ?? '');
        if (!rameId || !depotId || this.maintenanceQueue.some((m) => m.rameId === rameId))
            return false;
        const depot = this.depots.find((d) => d.id === depotId);
        if (!depot || depot.type !== 'depot' || !depot.built)
            return false;
        const game = typeof window !== 'undefined' ? window.game : null;
        const rame = game?.rameManager?.getById?.(rameId);
        if (rame) {
            const inService = (game?.scheduleCreator?.services || []).some((s) => (s.rame?.id === rameId || s._v2DirectRameId === rameId || s._v2AssignedRameId === rameId) &&
                !s.completed && !s.cancelled && s.position && (s.state === 'moving' || s.state === 'departing' || Number(s.currentStopIndex) > 0));
            if (inService || (rame.currentLocation?.depotId !== depotId && !depot.findRameTrack?.(rameId)))
                return false;
        }
        const duration = depot.getMaintenanceDuration(20);
        this.maintenanceQueue.push({
            rameId: rameId,
            depotId: depotId,
            remainingMin: duration,
            totalMin: duration,
            rameName: (rameName || rameId),
        });
        return true;
    }
    isRameInMaintenance(rameId) {
        return this.maintenanceQueue.some((m) => m.rameId === rameId);
    }
    getRameMaintenanceInfo(rameId) {
        return this.maintenanceQueue.find((m) => m.rameId === rameId) || null;
    }
    isInRepairOrMaintenance(serviceId) {
        return this.repairQueue.some((r) => r.serviceId === serviceId);
    }
    getRepairInfo(serviceId) {
        return this.repairQueue.find((r) => r.serviceId === serviceId) || null;
    }
    // Get active rescues as pseudo-services for rendering on map
    getRescueServices() {
        return this.activeRescues.filter((r) => r.position).map((r) => ({
            id: r.id,
            name: r.stockName || 'Secours',
            position: r.position,
            state: 'moving',
            isRescue: true,
            rescueState: r.state,
            rescueCanRetry: ['routing', 'routing_return'].includes(r.state) && !r._routeRequestInFlight && Number(r._routeRetryAtMs || 0) <= Date.now(),
            train: {
                speed: Math.round(r.speed),
                delayReason: r.routeStatusMessage || '',
                color: '#ef4444', // red for rescue
                stoppedAt: null,
                incident: null,
                delay: 0,
                seriesName: '',
                number: '',
                platform: null,
            },
        }));
    }
    toSave() {
        return cloneRailValue({
            physicalSchemaVersion: 1, physicalOperations: this.physicalOperations.map(op => ({ ...op, route: op.route.map(p => ({ ...p })), position: { ...op.position }, vehicleIds: [...op.vehicleIds], movementSnapshot: this._depotMovements.get(op.id)?.snapshot() || op.movementSnapshot })), vehicleUsage: [...this.vehicleUsage], nextPhysicalOperationId: this.nextPhysicalOperationId,
            rescuedOccurrenceIds: [...this.rescuedOccurrenceIds],
            rescuedFormations: this.rescuedFormations.map(f => ({ ...f, vehicleIds: [...f.vehicleIds] })),
            depots: this.depots.map((d) => ({
                id: d.id,
                type: d.type,
                name: d.name,
                stationId: d.stationId,
                stationUpgradeSource: d.stationUpgradeSource,
                stationUpgradeTracks: d.stationUpgradeTracks,
                tracks: d.tracks,
                cost: d.cost,
                built: d.built,
                creationPackVersion: d.creationPackVersion,
                creationStaffProvisioned: d.creationStaffProvisioned,
                creationStaffIds: d.creationStaffIds,
                infrastructure: d.infrastructure,
                equipmentInventory: d.equipmentInventory,
                ramesStored: d.ramesStored,
                schemaVersion: d.schemaVersion || 1,
                location: d.location,
                placementOnly: d.placementOnly === true,
                railSections: d.railSections,
                iteTracks: d.iteTracks,
                iteCargoTypes: d.iteCargoTypes,
                rescueLocos: d.rescueLocos,
                spareParts: { moteur: d.partInventory.engine_generic || 0, climatisation: d.partInventory.hvac_unit || 0, fanaux: d.partInventory.headlight_unit || 0, freins: d.partInventory.brake_pad_set || 0, portes: d.partInventory.door_drive || 0 },
                partInventory: d.partInventory,
                resourceStocks: d.resourceStocks,
                resourceCapacities: d.resourceCapacities,
                resourceUsage: d.resourceUsage,
                trackOccupancy: d.trackOccupancy, trackDefinitions: d.trackDefinitions, vehiclePositions: d.vehiclePositions,
                utilityTotals: d.utilityTotals,
                expenseLedger: d.expenseLedger,
            })),
            // Route callbacks and later movement must not mutate an in-flight save.
            activeRescues: this.activeRescues.map(r => ({ ...r, movementSnapshot: this._rescueMovements.get(r.id)?.snapshot() || r.movementSnapshot, _routeRequestInFlight: false, towVehicleIds: [...(r.towVehicleIds || [])],
                position: r.position ? { ...r.position } : null, targetPosition: r.targetPosition ? { ...r.targetPosition } : null, depotPosition: r.depotPosition ? { ...r.depotPosition } : null,
                route: r.route?.map(p => ({ ...p })) ?? null, returnRoute: r.returnRoute?.map(p => ({ ...p })) ?? null })),
            repairQueue: this.repairQueue.map(q => ({ ...q, vehicleIds: [...(q.vehicleIds || [])] })),
            maintenanceQueue: this.maintenanceQueue,
            supplyOrders: this.supplyOrders.map(o => ({ ...o })),
            depotOperations: this.depotOperations,
        });
    }
    loadFromSave(data, context = {}) {
        this._pendingCreationStaff.clear();
        for (const s of this._rescueMovements.values())
            s._releaseAllPhysicalResources();
        this._rescueMovements.clear();
        this.depots = [];
        this.activeRescues = [];
        this.depotOperations = [];
        this.rescuedFormations = [];
        // Support both old format (array) and new format (object with depots + activeRescues)
        const obj = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        this.rescuedOccurrenceIds = new Set(Array.isArray(obj.rescuedOccurrenceIds) ? obj.rescuedOccurrenceIds.filter((x) => typeof x === 'string' && x.startsWith('v2:')) : []);
        const arr = Array.isArray(data) ? data : (Array.isArray(obj.depots) ? obj.depots : []);
        const seenDepotIds = new Set();
        for (const d of arr) {
            if (!d || typeof d !== 'object')
                continue;
            const normalized = { ...d, id: String(d.id ?? ''), stationId: String(d.stationId ?? '') };
            const depot = new Depot(normalized);
            this._connectDepotStockFinance(depot);
            // Enterprise terminals use the historical "ite" type; Simple parcel
            // assets are legitimate point facilities even before a station is linked.
            if (!depot.id || seenDepotIds.has(depot.id) || (!depot.stationId && !depot.placementOnly) || !['depot', 'ite', 'ite-fret', 'ite-industrie', 'ite-logistique'].includes(depot.type))
                continue;
            seenDepotIds.add(depot.id);
            this.depots.push(depot);
            const num = parseInt(String(d.id).split('-')[1] || '0');
            if (num >= nextDepotId)
                nextDepotId = num + 1;
        }
        if (!Array.isArray(data) && Array.isArray(obj.activeRescues)) {
            const rescueStates = new Set(['routing', 'en_route', 'recovering', 'routing_return', 'returning', 'done']);
            const validCoord = (p) => rescuePoint(p) !== null;
            const seenRescueIds = new Set(), seenRescueLocos = new Set();
            this.activeRescues = obj.activeRescues.filter((r) => r && typeof r === 'object' && !Array.isArray(r)).map((raw) => {
                const r = raw;
                const depotId = String(r.depotId ?? ''), stockId = String(r.stockId ?? ''), id = String(r.id ?? '');
                if (!depotId || !stockId || !id || seenRescueIds.has(id) || seenRescueLocos.has(`${depotId}|${stockId}`))
                    return null;
                seenRescueIds.add(id);
                seenRescueLocos.add(`${depotId}|${stockId}`);
                const rawState = String(r.state || '');
                const state = rescueStates.has(rawState) ? rawState : 'routing';
                const finite = (v, fb = 0) => Number.isFinite(Number(v)) ? Number(v) : fb;
                const route = validatedRescueRoute(r.route);
                const returnRoute = validatedRescueRoute(r.returnRoute);
                const motion = validRescueMotion(r.movementSnapshot);
                const invalidMotion = r._motionInvalid === true || (r.movementSnapshot != null && !motion);
                return { ...r, movementSnapshot: motion || undefined, _motionInvalid: invalidMotion, id, depotId, stockId, towAttached: r.towAttached === true, towDistanceKm: Math.max(0, finite(r.towDistanceKm)), towRameId: typeof r.towRameId === 'string' ? r.towRameId : '', towVehicleIds: Array.isArray(r.towVehicleIds) ? r.towVehicleIds.filter((v) => typeof v === 'string') : [], stockName: String(r.stockName || '').slice(0, 160), targetServiceId: String(r.targetServiceId ?? ''), state, position: validCoord(r.position) ? { lat: Number(r.position.lat), lon: Number(r.position.lon) } : null, targetPosition: validCoord(r.targetPosition) ? { lat: Number(r.targetPosition.lat), lon: Number(r.targetPosition.lon) } : null, depotPosition: validCoord(r.depotPosition) ? { lat: Number(r.depotPosition.lat), lon: Number(r.depotPosition.lon) } : null, speed: Math.max(0, finite(r.speed, 0)), progress: Math.max(0, finite(r.progress, 0)), route, returnRoute, routeIndex: Math.max(0, Math.floor(finite(r.routeIndex, 0))), _routeRequestInFlight: false, _routeRetrySec: Math.max(0, finite(r._routeRetrySec, 0)), _routeRetryAtMs: Math.max(0, finite(r._routeRetryAtMs, 0)), _routeFailureCount: Math.max(0, Math.min(16, Math.floor(finite(r._routeFailureCount, 0)))), _routeAccessDenied: r._routeAccessDenied === true, routeStatusMessage: typeof r.routeStatusMessage === 'string' ? r.routeStatusMessage.slice(0, 240) : '', _recoverTimer: typeof r._recoverTimer === 'number' ? Math.max(0, finite(r._recoverTimer, 5)) : 5 };
            }).filter(Boolean).map((raw) => {
                const r = raw;
                const targetComponent = REPAIR_COMPONENT_BY_BREAKDOWN[String(r.repairType)] === r.targetComponent ? String(r.targetComponent) : '';
                return { ...r, targetComponent, targetVehicleId: targetComponent ? String(r.targetVehicleId || '') : '' };
            });
            for (const r of this.activeRescues) {
                let route = r.state === 'returning' ? r.returnRoute : r.route;
                const endpoint = r.state === 'returning' ? r.depotPosition : r.targetPosition;
                if (route && endpoint && rescueDistanceKm(route[route.length - 1], endpoint) > RESCUE_ENDPOINT_TOLERANCE_KM) {
                    if (r.state === 'returning')
                        r.returnRoute = null;
                    else
                        r.route = null;
                    route = null;
                }
                if (r._routeAccessDenied && !r._routeRetryAtMs)
                    r._routeRetryAtMs = Date.now() + 900000;
                if ((r.state === 'en_route' || r.state === 'returning') && !route) {
                    r.state = r.state === 'returning' ? 'routing_return' : 'routing';
                    r.speed = 0;
                    r.routeIndex = 0;
                    r.routeStatusMessage = 'Tracé sauvegardé invalide : recalcul nécessaire';
                }
                else if (route && (r.routeIndex >= route.length - 1) && r.position && rescueDistanceKm(r.position, route[route.length - 1]) > RESCUE_ENDPOINT_TOLERANCE_KM) {
                    // An out-of-range saved index is not evidence of a completed journey.
                    if (r.state === 'en_route' || r.state === 'returning') {
                        r.state = r.state === 'returning' ? 'routing_return' : 'routing';
                        r.speed = 0;
                        r.routeStatusMessage = 'Progression sauvegardée incohérente : recalcul nécessaire';
                    }
                    r.routeIndex = 0;
                }
                else if (route)
                    r.routeIndex = Math.min(r.routeIndex, route.length - 1);
                const num = parseInt(String(r.id || '').split('-')[1] || '0');
                if (num >= nextRescueId)
                    nextRescueId = num + 1;
            }
        }
        if (!Array.isArray(data) && Array.isArray(obj.maintenanceQueue)) {
            // Migrate old format (serviceId) to new format (rameId)
            const seenRames = new Set();
            this.maintenanceQueue = obj.maintenanceQueue
                .filter((m) => m && typeof m === 'object')
                .map((m) => { const rameId = String(m.rameId ?? m.serviceId ?? ''), depotId = String(m.depotId ?? ''), remaining = Number(m.remainingMin), total = Number(m.totalMin); return { rameId, depotId, remainingMin: remaining, totalMin: Number.isFinite(total) && total > 0 ? total : 20, rameName: String(m.rameName ?? m.serviceName ?? '') }; })
                .filter((m) => m.rameId && !seenRames.has(m.rameId) && Number.isFinite(m.remainingMin) && m.remainingMin > 0 && (seenRames.add(m.rameId), true));
        }
        else {
            this.maintenanceQueue = [];
        }
        if (!Array.isArray(data) && Array.isArray(obj.repairQueue)) {
            const seenServices = new Set();
            this.repairQueue = obj.repairQueue
                .filter((r) => r && typeof r === 'object')
                .map((r) => { const serviceId = String(r.serviceId ?? ''), depotId = String(r.depotId ?? ''), remaining = Number(r.remainingMin), total = Number(r.totalMin); return { serviceId, depotId, rameId: typeof r.rameId === 'string' ? r.rameId : '', vehicleIds: Array.isArray(r.vehicleIds) ? r.vehicleIds.filter((v) => typeof v === 'string') : [], remainingMin: remaining, totalMin: Number.isFinite(total) && total > 0 ? total : 30, serviceName: String(r.serviceName ?? ''), repairType: ['moteur', 'freins', 'climatisation', 'portes', 'fanaux'].includes(String(r.repairType ?? r.type)) ? String(r.repairType ?? r.type) : 'moteur', targetVehicleId: String(r.targetVehicleId || ''), targetComponent: String(r.targetComponent || ''), accelerated: r.accelerated === true, partsReserved: r.partsReserved === true }; })
                .filter((r) => r.serviceId && !seenServices.has(r.serviceId) && Number.isFinite(r.remainingMin) && r.remainingMin > 0 && (seenServices.add(r.serviceId), true))
                .map((r) => {
                const targetComponent = REPAIR_COMPONENT_BY_BREAKDOWN[r.repairType] === r.targetComponent ? String(r.targetComponent) : '';
                return { ...r, targetComponent, targetVehicleId: targetComponent && (r.vehicleIds || []).includes(String(r.targetVehicleId || '')) ? String(r.targetVehicleId) : '' };
            });
        }
        else {
            this.repairQueue = [];
        }
        const seenSupplyOrders = new Set();
        this.supplyOrders = (Array.isArray(obj.supplyOrders) ? obj.supplyOrders : []).flatMap((raw) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                return [];
            const o = raw, orderId = String(o.orderId || ''), depotId = String(o.depotId || ''), kind = String(o.kind || ''), key = String(o.key || '');
            const qty = Number(o.qty), remainingMin = Number(o.remainingMin), totalMin = Number(o.totalMin);
            if (!orderId || seenSupplyOrders.has(orderId) || !this.getDepotById(depotId)?.built || !['part', 'resource'].includes(kind) || !key || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(remainingMin) || remainingMin <= 0 || !Number.isFinite(totalMin) || totalMin <= 0)
                return [];
            if (kind === 'part' && (!Number.isInteger(qty) || !DEPOT_PART_CATALOG.some(p => p.id === key)))
                return [];
            if (kind === 'resource' && !DEPOT_RESOURCE_CATALOG[key]?.stock)
                return [];
            seenSupplyOrders.add(orderId);
            const match = /^supply-(\d+)$/.exec(orderId);
            if (match && Number(match[1]) >= nextDepotSupplyOrderId)
                nextDepotSupplyOrderId = Number(match[1]) + 1;
            return [{ orderId, depotId, kind: kind, key, qty, remainingMin, totalMin, accelerated: o.accelerated === true }];
        });
        if (!Array.isArray(data) && Array.isArray(obj.depotOperations)) {
            const seenOps = new Set();
            this.depotOperations = obj.depotOperations.filter((o) => o && typeof o === 'object').map((o) => {
                const id = String(o.id || ''), depotId = String(o.depotId || ''), rameId = String(o.rameId || ''), remaining = Math.max(0, Number(o.remainingMin) || 0), total = Math.max(1, Number(o.totalMin) || 1);
                if (!id || !depotId || !rameId || seenOps.has(id) || remaining <= 0)
                    return null;
                seenOps.add(id);
                const m = /^depot-op-(\d+)$/.exec(id);
                if (m && Number(m[1]) >= nextDepotOperationId)
                    nextDepotOperationId = Number(m[1]) + 1;
                const opId = String(o.opId || ''), targetComponent = String(o.targetComponent || '');
                return { ...o, id, depotId, rameId, rameName: String(o.rameName || ''), opId, label: String(o.label || ''), group: String(o.group || ''), remainingMin: remaining, totalMin: total, state: 'running', staff: o.staff && typeof o.staff === 'object' ? { ...o.staff } : {}, resources: o.resources && typeof o.resources === 'object' ? { ...o.resources } : {}, parts: o.parts && typeof o.parts === 'object' ? { ...o.parts } : {}, equipment: Array.isArray(o.equipment) ? o.equipment.filter((x) => DEPOT_EQUIPMENT_CATALOG[String(x)]) : [], staffIds: Array.isArray(o.staffIds) ? o.staffIds.map(String).filter(Boolean) : [], targetVehicleId: o.comfortCode || REPAIR_COMPONENT_BY_OPERATION[String(opId)] === targetComponent ? String(o.targetVehicleId || '') : '', targetComponent: REPAIR_COMPONENT_BY_OPERATION[String(opId)] === targetComponent ? targetComponent : '' };
            }).filter(Boolean);
        }
        if (obj.physicalSchemaVersion != null && obj.physicalSchemaVersion !== 1)
            throw new Error('Version des mouvements dépôt incompatible.');
        for (const movement of this._depotMovements.values())
            movement._releaseAllPhysicalResources();
        this._depotMovements.clear();
        this.vehicleUsage = new Map(Array.isArray(obj.vehicleUsage) ? obj.vehicleUsage : []);
        this.physicalOperations = [];
        this.nextPhysicalOperationId = Math.max(1, Number(obj.nextPhysicalOperationId) || 1);
        const physicalOwners = new Set();
        for (const value of Array.isArray(obj.physicalOperations) ? obj.physicalOperations : []) {
            const op = value;
            if (!op?.id || !op.rameId || !this.getDepotById(op.destinationDepotId) || !Array.isArray(op.route) || op.route.length < 2 || !Array.isArray(op.vehicleIds) || op.vehicleIds.some(id => physicalOwners.has(id)) || op.state === 'done')
                continue;
            const snapshot = op.movementSnapshot == null ? null : validRescueMotion(op.movementSnapshot);
            if (op.movementSnapshot != null && !snapshot)
                throw new Error('Position sauvegardée de mouvement dépôt invalide.');
            op.vehicleIds.forEach(id => physicalOwners.add(id));
            this.physicalOperations.push({ ...op, route: op.route.map(p => ({ ...p })), position: { ...op.position }, movementSnapshot: snapshot || undefined });
        }
        this.reconcilePhysicalReservations(context);
        // Runtime promises do not survive reload. Reconcile deployment flags from the
        // actual restored rescue list so a vanished rescue can never lock a loco forever.
        const seenTargets = new Set();
        this.activeRescues = this.activeRescues.filter((r) => {
            if (r.state === 'done' || (r.targetServiceId && seenTargets.has(r.targetServiceId)))
                return false;
            const depot = this.getDepotById(r.depotId);
            const valid = !!(depot?.built && depot.type === 'depot' && depot.rescueLocos?.some((l) => l.stockId === r.stockId));
            if (valid && r.targetServiceId)
                seenTargets.add(r.targetServiceId);
            return valid;
        });
        const validBuiltDepotIds = new Set(this.depots.filter((d) => d.built).map((d) => d.id));
        const formationIds = new Set();
        for (const value of Array.isArray(obj.rescuedFormations) ? obj.rescuedFormations : []) {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                continue;
            const f = value, id = String(f.id || ''), depotId = String(f.depotId || '');
            const vehicleIds = Array.isArray(f.vehicleIds) ? [...new Set(f.vehicleIds.filter((v) => typeof v === 'string' && !!v))] : [];
            if (!id || formationIds.has(id) || !validBuiltDepotIds.has(depotId) || !vehicleIds.length || !this.getDepotById(depotId)?.findRameTrack(id))
                continue;
            formationIds.add(id);
            this.rescuedFormations.push({ id, depotId, name: String(f.name || id), serviceId: String(f.serviceId || ''), vehicleIds });
        }
        this.maintenanceQueue = this.maintenanceQueue.filter((q) => q.rameId && validBuiltDepotIds.has(q.depotId) && Number.isFinite(Number(q.remainingMin)) && Number(q.remainingMin) > 0).map((q) => ({ ...q, remainingMin: Number(q.remainingMin), totalMin: Number.isFinite(Number(q.totalMin)) && Number(q.totalMin) > 0 ? Number(q.totalMin) : 20 }));
        this.repairQueue = this.repairQueue.filter((q) => q.serviceId && validBuiltDepotIds.has(q.depotId) && Number.isFinite(Number(q.remainingMin)) && Number(q.remainingMin) > 0).map((q) => ({ ...q, remainingMin: Number(q.remainingMin), totalMin: Number.isFinite(Number(q.totalMin)) && Number(q.totalMin) > 0 ? Number(q.totalMin) : 30 }));
        this.depotOperations = this.depotOperations.filter((o) => validBuiltDepotIds.has(o.depotId));
        const opByRame = new Map(this.depotOperations.map((o) => [String(o.rameId), o]));
        for (const depot of this.getDepots()) {
            if (!Array.isArray(depot.trackOccupancy) || depot.trackOccupancy.length !== depot.tracks)
                depot.trackOccupancy = Array.from({ length: depot.tracks }, (_, i) => ({ track: i + 1, rameId: '', purpose: 'garage', operationId: '' }));
            for (const slot of depot.trackOccupancy) {
                if (slot.rameId) {
                    const op = opByRame.get(slot.rameId);
                    slot.operationId = op?.id || '';
                    slot.purpose = op?.group || 'garage';
                }
            }
        }
        const rescueKeys = new Set(this.activeRescues.map((r) => `${r.depotId}|${r.stockId}`));
        for (const depot of this.depots)
            for (const loco of depot.rescueLocos || []) {
                loco.deployed = rescueKeys.has(`${depot.id}|${loco.stockId}`);
            }
    }
}
