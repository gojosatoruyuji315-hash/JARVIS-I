/**
 * Minimal i18n for navigation & core UI strings.
 * Add a language by adding a dictionary; missing keys fall back to English.
 * @module core/i18n
 */
import { store } from './store.js';

const DICT = {
  en: { home: 'Home', assistant: 'Assistant', productivity: 'Tasks & Notes', study: 'Study', dev: 'Code', files: 'Files', music: 'Music', memory: 'Memory', automation: 'Routines', analytics: 'Insights', workspace: 'AI Workspace', plugins: 'Plugins', plugin: 'Plugin', settings: 'Settings', account: 'Account', search: 'Search', ask: 'Ask JARVIS-X or type a command…', upgrade: 'Upgrade' },
  es: { home: 'Inicio', assistant: 'Asistente', productivity: 'Productividad', study: 'Modo estudio', dev: 'Espacio de desarrollo', files: 'Archivos', music: 'Música', memory: 'Memoria', automation: 'Automatización', analytics: 'Analítica', workspace: 'Espacio de trabajo', plugins: 'Complementos', plugin: 'Complemento', settings: 'Ajustes', account: 'Cuenta', search: 'Buscar', ask: 'Pregunta a JARVIS-X o escribe un comando…', upgrade: 'Mejorar' },
  fr: { home: 'Accueil', assistant: 'Assistant', productivity: 'Productivité', study: 'Mode étude', dev: 'Espace développeur', files: 'Fichiers', music: 'Musique', memory: 'Mémoire', automation: 'Automatisation', analytics: 'Analytique', workspace: 'Espace de travail', plugins: 'Extensions', plugin: 'Extension', settings: 'Paramètres', account: 'Compte', search: 'Rechercher', ask: 'Demandez à JARVIS-X ou tapez une commande…', upgrade: 'Passer à Pro' },
  hi: { home: 'होम', assistant: 'सहायक', productivity: 'उत्पादकता', study: 'अध्ययन मोड', dev: 'डेवलपर वर्कस्पेस', files: 'फ़ाइलें', music: 'संगीत', memory: 'स्मृति', automation: 'स्वचालन', analytics: 'विश्लेषण', workspace: 'वर्कस्पेस', plugins: 'प्लगइन', plugin: 'प्लगइन', settings: 'सेटिंग्स', account: 'खाता', search: 'खोजें', ask: 'JARVIS-X से पूछें या कमांड लिखें…', upgrade: 'अपग्रेड' },
  de: { home: 'Start', assistant: 'Assistent', productivity: 'Produktivität', study: 'Lernmodus', dev: 'Entwickler-Arbeitsplatz', files: 'Dateien', music: 'Musik', memory: 'Gedächtnis', automation: 'Automatisierung', analytics: 'Analysen', workspace: 'Arbeitsbereich', plugins: 'Plugins', plugin: 'Plugin', settings: 'Einstellungen', account: 'Konto', search: 'Suchen', ask: 'Frag JARVIS-X oder gib einen Befehl ein…', upgrade: 'Upgrade' },
};
export const LANGUAGES = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', hi: 'हिन्दी' };
export const t = (key) => (DICT[store.get('settings.language')] || DICT.en)[key] ?? DICT.en[key] ?? key;
