 import { describe, expect, it } from 'vitest';
 import {
   alertIcon,
   checkIcon,
   chevronDown,
   chevronRight,
   circleIcon,
   refreshIcon,
 } from '../../src/ui/icons.js';

 describe('icons', () => {
   it.each([
     ['chevronRight', chevronRight],
     ['chevronDown', chevronDown],
     ['checkIcon', checkIcon],
     ['circleIcon', circleIcon],
     ['refreshIcon', refreshIcon],
     ['alertIcon', alertIcon],
   ])('%s returns an SVG string', (_name, fn) => {
     expect(fn()).toContain('<svg');
   });
 });
