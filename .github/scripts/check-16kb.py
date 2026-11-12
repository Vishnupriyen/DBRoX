#!/usr/bin/env python3
"""Google Play's 16 KB rule (apps targeting Android 15+): every native library in the APK must be built with 16 KB pages
(each ELF LOAD segment aligned to 16384) and stored uncompressed at a 16 KB boundary. Fails the build with the library named."""
import struct, sys, zipfile

def elf_ok(data):
    if data[:4] != b'\x7fELF' or data[4] != 2:   # 64-bit only: 32-bit ABIs are not covered by the rule
        return True
    phoff, = struct.unpack_from('<Q', data, 0x20)
    phentsize, phnum = struct.unpack_from('<HH', data, 0x36)
    for i in range(phnum):
        p_type, = struct.unpack_from('<I', data, phoff + i * phentsize)
        if p_type == 1:  # PT_LOAD
            p_align, = struct.unpack_from('<Q', data, phoff + i * phentsize + 0x30)
            if p_align < 16384:
                return False
    return True

bad = []
with zipfile.ZipFile(sys.argv[1]) as z:
    libs = [i for i in z.infolist() if i.filename.startswith('lib/') and i.filename.endswith('.so')]
    for i in libs:
        if not elf_ok(z.read(i)):
            bad.append(f'{i.filename}: built with 4 KB pages')
        if i.compress_type == zipfile.ZIP_STORED:
            with open(sys.argv[1], 'rb') as f:   # data offset = header offset + 30 + name + extra (local header)
                f.seek(i.header_offset + 26); n, e = struct.unpack('<HH', f.read(4))
            if (i.header_offset + 30 + n + e) % 16384:
                bad.append(f'{i.filename}: not stored at a 16 KB boundary')
print(f'16 KB check: {len(libs)} native libraries')
for b in bad: print('  ✘', b)
sys.exit(1 if bad else 0)
