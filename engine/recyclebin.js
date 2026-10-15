'use strict';
/**
 * Windows Recycle Bin: measured and emptied through the Windows shell (SHQueryRecycleBin / SHEmptyRecycleBin),
 * exactly as File Explorer's "Empty Recycle Bin" does. Clearspace never deletes inside $Recycle.Bin by hand.
 */
const { run } = require('./util');

const TYPE = `
using System;
using System.Runtime.InteropServices;
public static class ClearspaceRecycleBin {
  [StructLayout(LayoutKind.Sequential)]
  public struct SHQUERYRBINFO { public int cbSize; public long i64Size; public long i64NumItems; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHQueryRecycleBinW(string root, ref SHQUERYRBINFO info);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHEmptyRecycleBinW(IntPtr hwnd, string root, uint flags);
  public static string Query() {
    var i = new SHQUERYRBINFO(); i.cbSize = Marshal.SizeOf(typeof(SHQUERYRBINFO));
    int hr = SHQueryRecycleBinW(null, ref i);
    return hr == 0 ? (i.i64Size + " " + i.i64NumItems) : ("ERR " + hr);
  }
  // SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND
  public static int Empty() { return SHEmptyRecycleBinW(IntPtr.Zero, null, 7); }
}`;

function powershell(body, timeout) {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition @'\n${TYPE}\n'@; ${body}`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout });
}

/** { size, count } over all drives, or null when Windows could not tell. */
async function recycleBinInfo() {
  const r = await powershell('[ClearspaceRecycleBin]::Query()', 60000);
  const m = /^(\d+) (\d+)\s*$/m.exec(r.stdout || '');
  return r.code === 0 && m ? { size: Number(m[1]), count: Number(m[2]) } : null;
}

/** Empty the Recycle Bin on every drive. Throws when Windows refused. */
async function emptyRecycleBin() {
  const r = await powershell('[ClearspaceRecycleBin]::Empty()', 900000);
  const hr = Number((r.stdout || '').trim());
  // S_OK, or E_UNEXPECTED (0x8000FFFF) which Windows returns when the Recycle Bin is already empty.
  if (r.code !== 0 || !(hr === 0 || hr === -2147418113)) {
    throw new Error(`Windows did not empty the Recycle Bin${Number.isFinite(hr) && r.code === 0 ? ` (error ${hr})` : ''}.`);
  }
}

module.exports = { recycleBinInfo, emptyRecycleBin };
