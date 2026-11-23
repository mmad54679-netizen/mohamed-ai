const CONNECTOR_DEFINITIONS = [
  { id: 'github', name: 'GitHub', category: 'code', readOnly: true, env: 'GITHUB_TOKEN', scopes: ['repos:read', 'issues:read'] },
  { id: 'google_drive', name: 'Google Drive / PDF / Word', category: 'files', readOnly: true, env: 'GOOGLE_DRIVE_TOKEN', scopes: ['drive.readonly'] },
  { id: 'gmail', name: 'Gmail', category: 'communication', readOnly: false, env: 'GMAIL_TOKEN', scopes: ['gmail.readonly', 'gmail.send'] },
  { id: 'calendar', name: 'Google Calendar', category: 'calendar', readOnly: false, env: 'GOOGLE_CALENDAR_TOKEN', scopes: ['calendar.readonly', 'calendar.events'] },
  { id: 'web_search', name: 'البحث في الويب', category: 'research', readOnly: true, env: 'WEB_SEARCH_API_KEY', scopes: ['search.read'] },
  { id: 'microphone', name: 'الميكروفون والصوت', category: 'device', readOnly: true, env: null, scopes: ['browser.microphone', 'browser.speech'] },
];

function connectorStatus(env = process.env) {
  return CONNECTOR_DEFINITIONS.map(item => ({
    id: item.id,
    name: item.name,
    category: item.category,
    readOnly: item.id === 'github' ? env.GITHUB_WRITE !== '1' : item.readOnly,
    scopes: item.scopes,
    available: item.id === 'microphone' ? true : Boolean(item.env && env[item.env]),
    configuredBy: item.id === 'microphone' ? 'browser-permission' : (item.env ? `server:${item.env}` : null),
  }));
}

module.exports = { CONNECTOR_DEFINITIONS, connectorStatus };
