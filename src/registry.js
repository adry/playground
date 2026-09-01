import curlDrift from './components/curlDrift.js';
import gyroidField from './components/gyroidField.js';

// Adding a piece to the lab is one import plus one entry here.
const factories = [
  curlDrift,
  gyroidField,
];

export const catalog = factories.map((factory) => {
  const probe = factory();
  return {
    id: probe.id,
    title: probe.title,
    note: probe.note,
    duration: probe.duration,
    factory,
  };
});

export function getComponent(id) {
  return catalog.find((c) => c.id === id) || catalog[0];
}
