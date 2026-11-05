"""Private parser worker: fixed input limits, no network, no user code execution."""
from io import BytesIO
import sys


def parse(data, kind):
    if kind.startswith('image/'):
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 16_000_000
        with Image.open(BytesIO(data)) as image:
            if image.format != {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}[kind]:
                raise ValueError()
            if image.width * image.height > 16_000_000 or getattr(image, 'n_frames', 1) != 1:
                raise ValueError()
            image.verify()
        # Actual decoding detects truncated payloads; isolated and bounded by dimensions.
        with Image.open(BytesIO(data)) as image:
            image.load()
        return ''
    from pypdf import PdfReader, Configuration
    # Limits apply before decoded streams/text can accumulate, not just after extraction.
    for key in ('maximum_declared_stream_length', 'array_based_stream_maximum_output_length',
                'zlib_maximum_output_length', 'lzw_maximum_output_length',
                'run_length_maximum_output_length', 'brotli_maximum_output_length',
                'image_maximum_buffer_size', 'stream_decoding_work_maximum_length'):
        setattr(Configuration, key, 4 * 1024 * 1024)
    reader = PdfReader(BytesIO(data), strict=True)
    if reader.is_encrypted or len(reader.pages) > 30:
        raise ValueError()
    parts = []
    size = 0
    for page in reader.pages:
        part = page.extract_text() or ''
        size += len(part) + bool(parts)
        if size > 20000:
            raise ValueError()
        parts.append(part)
    text = '\n'.join(parts)
    if not text.strip():
        raise ValueError()
    return text


def main():
    try:
        if sys.platform != 'win32':
            import resource
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
            resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
        data = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise ValueError()
        result = parse(data, sys.argv[1])
        sys.stdout.buffer.write(result.encode('utf-8'))
    except Exception:
        sys.exit(1)  # Never emit parser errors or private content.


if __name__ == '__main__':
    main()
