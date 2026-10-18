import path from 'node:path';
import {fileURLToPath} from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const workspacePath = (...parts) => path.resolve(workspaceRoot, ...parts);
export const diskPath = (...parts) => path.resolve(path.parse(workspaceRoot).root, ...parts);

// Remember folders on this disk relative to the app, so drive letters can change.
export function rememberFolder(appRoot, folder, paths = path) {
  return paths.parse(appRoot).root.toLowerCase() === paths.parse(folder).root.toLowerCase()
    ? paths.relative(appRoot, folder) || '.'
    : folder;
}

export function resolveFolder(appRoot, folder, paths = path) {
  return folder ? paths.resolve(appRoot, folder) : '';
}
