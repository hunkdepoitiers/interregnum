import { emptyEconomy, type Content } from '../../src/sim/content';

// Fixed-point hundredths throughout: 500 = 5, 1000 as pct = +10%.
export const content: Content = {
  stats: {
    development: { key: 'development', scope: 'province', label: 'Development', description: '', base: 500, min: 0, max: 2000, format: 'number' },
    tax: { key: 'tax', scope: 'province', label: 'Tax', description: '', base: 5000, min: 0, max: 10000, format: 'percent' },
    legitimacy: { key: 'legitimacy', scope: 'realm', label: 'Legitimacy', description: '', base: 6000, min: 0, max: 10000, format: 'number' },
  },
  modifiers: {
    capital: { key: 'capital', label: 'Capital', description: '', stacking: 'replace', days: null, effects: [{ stat: 'development', op: 'add', value: 500 }, { stat: 'tax', op: 'add', value: 1000 }] },
    boom: { key: 'boom', label: 'Boom', description: '', stacking: 'stack', days: null, effects: [{ stat: 'development', op: 'pct', value: 1000 }] },
    famine: { key: 'famine', label: 'Famine', description: '', stacking: 'replace', days: 10, effects: [{ stat: 'tax', op: 'add', value: -2000 }] },
    crown: { key: 'crown', label: 'Strong Crown', description: '', stacking: 'replace', days: null, effects: [{ stat: 'tax', op: 'add', value: 500 }, { stat: 'legitimacy', op: 'add', value: 500 }] },
    golden: { key: 'golden', label: 'Golden Age', description: '', stacking: 'replace', days: null, effects: [{ stat: 'development', op: 'add', value: 5000 }] },
  },
  cultures: [],
  religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: emptyEconomy(),
};
