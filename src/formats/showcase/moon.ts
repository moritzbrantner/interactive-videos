import type { ShowcaseDisclosure } from './overlay';

/**
 * Contextual details for the Moon showcase. Each disclosure belongs to the scene that states
 * the fact it expands on; figures are rounded public reference values (NASA lunar fact sheet).
 */
export const MOON_SHOWCASE_DISCLOSURES: readonly ShowcaseDisclosure[] = [
  {
    kind: 'preview',
    sceneId: 'distance',
    label: '384,400 km',
    title: 'Average Earth–Moon distance',
    body: 'Light covers it in about 1.3 seconds; the orbit varies between roughly 363,000 and 405,000 km.',
  },
  {
    kind: 'popover',
    sceneId: 'phases',
    label: 'Why phases?',
    title: 'Sunlight and viewing angle',
    body: 'Half of the Moon is always lit by the Sun. As it orbits, we see more or less of that lit half: new, crescent, quarter, gibbous, full.',
  },
  {
    kind: 'accordion',
    sceneId: 'tides',
    label: 'How tides form',
    title: 'Two bulges of water',
    body: 'The Moon pulls the near-side ocean more strongly than Earth’s centre, and the centre more than the far side, so most coasts see two high tides a day.',
  },
  {
    kind: 'dialog',
    sceneId: 'landing',
    label: 'Mission details',
    title: 'Apollo 11, July 1969',
    body: 'Neil Armstrong and Buzz Aldrin landed the lunar module Eagle in the Sea of Tranquility on 20 July 1969 while Michael Collins orbited in Columbia. They spent about 21.5 hours on the surface.',
  },
];
