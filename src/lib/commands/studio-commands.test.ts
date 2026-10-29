import { describe, expect, it, vi } from 'vitest';
import { createStudioCommands } from './studio-commands';

describe('shared Studio commands', () => {
  it('uses current availability and handlers for every dispatch source', async () => {
    const commands = createStudioCommands();
    const first = vi.fn();
    const second = vi.fn();
    const dispose = commands.register('document', { save: { enabled: true, execute: first } });
    await commands.execute('save');
    commands.register('document', { save: { enabled: false, execute: second } });
    dispose(); // An old effect must not remove a newer registration.
    expect(commands.state().save?.enabled).toBe(false);
    await commands.execute('save');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
  it('releases synchronous commands before publishing menu availability', async () => {
    const commands = createStudioCommands();
    commands.register('view', { variables: { enabled: true, execute: () => {} } });
    const pending = commands.execute('variables');
    expect(commands.state().variables?.enabled).toBe(true);
    await pending;
  });
  it('prevents overlapping async file actions', async () => {
    const commands = createStudioCommands();
    let finish!: () => void;
    const save = vi.fn();
    commands.register('document', {
      open: { enabled: true, execute: () => new Promise<void>((resolve) => { finish = resolve; }) },
      save: { enabled: true, execute: save },
    });
    const opening = commands.execute('open');
    expect(commands.state().save?.enabled).toBe(false);
    expect(await commands.execute('save')).toBe(false);
    finish();
    await opening;
    await commands.execute('save');
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('removes canvas commands when its view unmounts', async () => {
    const commands = createStudioCommands();
    const remove = commands.register('graph', { copy: { enabled: true, execute: vi.fn() } });
    remove();
    expect(await commands.execute('copy')).toBe(false);
    expect(commands.state().copy).toBeUndefined();
  });
  it('reports failures and releases the command lock', async () => {
    const commands = createStudioCommands();
    const report = vi.fn();
    commands.onError(report);
    commands.register('document', { save: { enabled: true, execute: () => { throw Error('disk full'); } } });
    expect(await commands.execute('save')).toBe(false);
    expect(report).toHaveBeenCalledOnce();
    expect(commands.state().save?.enabled).toBe(true);
  });
});
