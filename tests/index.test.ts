import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
class MockWebSocket {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  send = vi.fn();
  close = vi.fn();
}

import { mount, unmount } from '../src/index.js';
import type { PluginAPI } from '../src/types.js';
import { wait } from './utils.js';

function makeElement(tag: string): HTMLElement {
  const children: HTMLElement[] = [];
  const style = {
    _props: {} as Record<string, string>,
    setProperty: vi.fn((key: string, value: string) => {
      style._props[key] = value;
    }),
    getPropertyValue: vi.fn((key: string) => style._props[key] ?? ''),
  } as unknown as CSSStyleDeclaration;
  const el: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    style,
    dataset: {} as DOMStringMap,
    className: '',
    appendChild: vi.fn((child: HTMLElement) => {
      children.push(child);
      return child;
    }),
    addEventListener: vi.fn(),
    querySelector: vi.fn().mockReturnValue(null),
    querySelectorAll: vi.fn().mockReturnValue([] as unknown as NodeListOf<Element>),
  };
  Object.defineProperty(el, 'innerHTML', {
    get: () => children.map((c) => (c as unknown as { innerHTML: string }).innerHTML).join(''),
    set: (value: string) => {
      children.length = 0;
      children.push({ innerHTML: value } as unknown as HTMLElement);
    },
    enumerable: true,
    configurable: true,
  });
  return el as unknown as HTMLElement;
}

function makeDocument(): Document {
  return {
    createElement: vi.fn().mockImplementation((tag: string) => makeElement(tag)),
    getElementById: vi.fn().mockReturnValue(null),
    head: { appendChild: vi.fn() } as unknown as HTMLHeadElement,
  } as unknown as Document;
}

describe('mount/unmount', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = makeElement('div');
    vi.stubGlobal('document', makeDocument());
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts and calls /watch rpc when project/session present', async () => {
    const rpc = vi.fn().mockResolvedValue({ tree: { version: 1, goals: [] }, status: 'idle' });
    const api: PluginAPI = {
      context: {
        theme: 'dark',
        project: { name: 'Test', path: '/test' },
        session: { id: 's1', title: 'Session' },
      },
      onContextChange: vi.fn().mockReturnValue(() => {}),
      rpc,
    };

    mount(container, api);
    await wait(0);

    expect(rpc).toHaveBeenCalledWith('POST', '/watch', { projectPath: '/test', sessionId: 's1' });
    expect(container.innerHTML).toContain('Progress');
    expect(container.innerHTML).toContain('Default');
    expect(container.innerHTML).toContain('ProgressTree');
  });

  it('unmount calls cleanup', () => {
    const unsubscribe = vi.fn();
    const api: PluginAPI = {
      context: { theme: 'dark', project: null, session: null },
      onContextChange: vi.fn().mockReturnValue(unsubscribe),
      rpc: vi.fn(),
    };

    mount(container, api);
    unmount(container);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('renders a non-disabled Refresh button when there is content', async () => {
    const rpc = vi.fn().mockResolvedValue({
      tree: {
        version: 1,
        goals: [{ id: 'g1', subject: 'Goal 1', status: 'in_progress', steps: [] }],
      },
      status: 'idle',
    });
    const api: PluginAPI = {
      context: {
        theme: 'dark',
        project: { name: 'Test', path: '/test' },
        session: { id: 's1', title: 'Session' },
      },
      onContextChange: vi.fn().mockReturnValue(() => {}),
      rpc,
    };

    mount(container, api);
    await wait(0);

    expect(container.innerHTML).toContain('Refresh');
    expect(container.innerHTML).not.toContain('Refreshing...');
    expect(container.innerHTML).not.toContain('disabled');
  });
});
