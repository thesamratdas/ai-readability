"""Small standalone helper functions with no shared state."""


def slugify(text):
    """Convert text to a lowercase, hyphen-separated slug."""
    cleaned = text.strip().lower()
    result = []
    for ch in cleaned:
        result.append(ch if ch.isalnum() else "-")
    return "".join(result)


async def fetch_with_retry(client, url, attempts=3):
    """Fetch a URL, retrying on failure up to `attempts` times."""
    last_error = None
    for _ in range(attempts):
        try:
            return await client.get(url)
        except Exception as e:
            last_error = e
    raise last_error
