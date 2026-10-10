/**
 * IPC wiring for meeting transcription (#6). All policy lives in ./meetings;
 * this file only binds it to ipcMain/shell. Every reply is built by the manager
 * and never contains the Groq key (see test/meetings.test.cjs).
 */
import { ipcMain, shell } from 'electron';
import { createMeetingManager, type MeetingDeps, type MeetingManager } from './meetings';

let manager: MeetingManager | null = null;

export function registerMeetingsIpc(deps: MeetingDeps): MeetingManager {
  const m = createMeetingManager(deps);
  manager = m;
  ipcMain.handle('meetings:status', () => m.status());
  ipcMain.handle('meetings:setPrefs', (_e, patch: unknown) => m.setPrefs(patch));
  ipcMain.handle('meetings:start', (_e, arg: unknown) => m.start(arg));
  ipcMain.handle('meetings:chunk', (_e, arg: unknown) => m.chunk(arg));
  ipcMain.handle('meetings:stop', (_e, arg: unknown) => m.stop(arg));
  ipcMain.handle('meetings:list', () => m.list());
  ipcMain.handle('meetings:pathFor', (_e, name: unknown) => m.pathFor(name));
  ipcMain.handle('meetings:openFolder', async () => {
    const s = m.status();
    if (!s.meetingsDir) return { ok: false, error: '아직 저장된 회의가 없습니다' };
    const err = await shell.openPath(s.meetingsDir);
    return err ? { ok: false, error: err } : { ok: true };
  });
  ipcMain.handle('meetings:openFile', async (_e, name: unknown) => {
    const r = m.pathFor(name);
    if (!r.ok) return r;
    const err = await shell.openPath(r.path);
    return err ? { ok: false, error: err } : { ok: true };
  });
  return m;
}

/** True while a meeting is recording; read by the window's mic permission gate. */
export function meetingMicArmed(): boolean {
  return manager?.micArmed() ?? false;
}

/** Close an in-progress transcript cleanly at app quit. */
export function shutdownMeetings(): void {
  manager?.shutdown();
}
