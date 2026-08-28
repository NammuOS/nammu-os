import type { PluginOption } from 'vite';

export function electronModuleRewrite(): PluginOption {
  return {
    name: 'electron-module-rewrite',
    generateBundle(_output, bundle) {
      for (const fileName of Object.keys(bundle)) {
        const chunk = bundle[fileName] as { type: string; code: string } | undefined;
        if (chunk && chunk.type === 'chunk') {
          if (/from\s+["']electron["']/.test(chunk.code)) {
            let newCode = chunk.code;
            let hasCreateRequire = /import\s*{[^}]*\bcreateRequire\b[^}]*}\s*from\s+["']node:module["']/.test(
              newCode,
            );

            const ensureCreateRequire = (): string => {
              if (hasCreateRequire) {
                hasCreateRequire = false;
                return '';
              }
              return 'import { createRequire } from "node:module";';
            };

            newCode = newCode.replace(
              /import\s*{\s*([^}]+)\s*}\s+from\s+["']electron["']/g,
              (_match, p1: string) => {
                const exports = p1
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter((s: string) => !s.startsWith('type '));
                const typeExports = p1
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter((s: string) => s.startsWith('type '));
                const destructured = exports.join(', ');
                const typePart = typeExports.length > 0 ? `, ${typeExports.join(', ')}` : '';
                const imp = ensureCreateRequire();
                return `${imp}\nconst { ${destructured}${typePart} } = createRequire(import.meta.url)("electron");`;
              }
            );

            newCode = newCode.replace(
              /import\s+(\w+)\s+from\s+["']electron["']/g,
              (_match, defaultName: string) => {
                const imp = ensureCreateRequire();
                return `${imp}\nconst ${defaultName} = createRequire(import.meta.url)("electron");`;
              }
            );

            newCode = newCode.replace(
              /import\s*\*\s*as\s+(\w+)\s+from\s+["']electron["']/g,
              (_match, namespaceName: string) => {
                const imp = ensureCreateRequire();
                return `${imp}\nconst ${namespaceName} = createRequire(import.meta.url)("electron");`;
              }
            );

            newCode = newCode.replace(
              /import\s+(\w+)\s*,\s*{\s*([^}]+)\s}\s+from\s+["']electron["']/g,
              (_match, defaultName: string, p1: string) => {
                const exports = p1
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter((s: string) => !s.startsWith('type '));
                const typeExports = p1
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter((s: string) => s.startsWith('type '));
                const destructured = exports.join(', ');
                const typePart = typeExports.length > 0 ? `, ${typeExports.join(', ')}` : '';
                const imp = ensureCreateRequire();
                return `${imp}\nconst ${defaultName} = createRequire(import.meta.url)("electron");\nconst { ${destructured}${typePart} } = ${defaultName};`;
              }
            );

            if (newCode !== chunk.code) {
              chunk.code = newCode;
            }
          }
        }
      }
    },
  };
}
