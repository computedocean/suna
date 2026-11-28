/**
 * The templates under the Apps page composer. A template only writes its
 * prompt into the composer: the person edits it and sends it, and the agent
 * builds the thing in a new session. Copy lives in `appCreate.templates.<id>`.
 *
 * Four kinds. An App is deployed and shows up on the Apps page. Slides,
 * Sheets and Docs are artifacts: the agent publishes them to Artifacts
 * (`kortix-artifacts` skill: a doc, or an html page for a deck or a sheet).
 */
export const APP_CREATE_KINDS = ['app', 'slides', 'sheet', 'doc'] as const;
export type AppCreateKind = (typeof APP_CREATE_KINDS)[number];

/** The wireframe a card draws. One shape per kind of output, drawn in CSS. */
export type AppTemplateArt =
  | 'checkin'
  | 'form'
  | 'chart'
  | 'board'
  | 'lookup'
  | 'directory'
  | 'deck'
  | 'deck-grid'
  | 'deck-chart'
  | 'table'
  | 'table-totals'
  | 'calendar'
  | 'doc'
  | 'doc-list'
  | 'doc-columns';

/** The card's one accent: a Kortix hue the wireframe takes on hover. */
export type AppTemplateHue = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'yellow';

export interface AppTemplate {
  id: string;
  kind: AppCreateKind;
  art: AppTemplateArt;
  hue: AppTemplateHue;
}

export const APP_TEMPLATES: readonly AppTemplate[] = [
  { id: 'attendance', kind: 'app', art: 'checkin', hue: 'green' },
  { id: 'requestForm', kind: 'app', art: 'form', hue: 'blue' },
  { id: 'metricsDashboard', kind: 'app', art: 'chart', hue: 'purple' },
  { id: 'projectBoard', kind: 'app', art: 'board', hue: 'orange' },
  { id: 'customerLookup', kind: 'app', art: 'lookup', hue: 'blue' },
  { id: 'teamDirectory', kind: 'app', art: 'directory', hue: 'yellow' },
  { id: 'pitchDeck', kind: 'slides', art: 'deck', hue: 'orange' },
  { id: 'quarterlyReview', kind: 'slides', art: 'deck-chart', hue: 'purple' },
  { id: 'productLaunch', kind: 'slides', art: 'deck-grid', hue: 'red' },
  { id: 'budget', kind: 'sheet', art: 'table-totals', hue: 'green' },
  { id: 'salesPipeline', kind: 'sheet', art: 'table', hue: 'blue' },
  { id: 'contentCalendar', kind: 'sheet', art: 'calendar', hue: 'yellow' },
  { id: 'projectBrief', kind: 'doc', art: 'doc', hue: 'blue' },
  { id: 'weeklyUpdate', kind: 'doc', art: 'doc-list', hue: 'green' },
  { id: 'productSpec', kind: 'doc', art: 'doc-columns', hue: 'purple' },
];

export function appTemplatesFor(kind: AppCreateKind): AppTemplate[] {
  return APP_TEMPLATES.filter((template) => template.kind === kind);
}
