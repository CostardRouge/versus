// The release this build belongs to: the one version in package.json (COMMON-PROJECT-SPEC C13, CHANGELOG.md).
// A named import, so the bundle carries the string and nothing else of that file.
import { version } from '../../package.json';

export const VERSION: string = version;
