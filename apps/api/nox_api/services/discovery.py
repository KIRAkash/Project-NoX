import logging
import re

logger = logging.getLogger(__name__)

# Regular expressions for interface signatures across languages/frameworks
REST_ROUTE_PATTERNS = [
    # FastAPI / Flask: @app.get("/api/v1/users")
    re.compile(r'@(?:app|router)\.(?:get|post|put|delete|patch|options|head)\s*\(\s*["\'](/[^"\']+)["\']', re.IGNORECASE),
    # Express / Node: app.get('/api/v1/users', ...)
    re.compile(r'(?:app|router)\.(?:get|post|put|delete|patch)\s*\(\s*["\'](/[^"\']+)["\']', re.IGNORECASE),
    # Spring Boot: @GetMapping("/api/v1/users")
    re.compile(r'@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?["\'](/[^"\']+)["\']', re.IGNORECASE),
    # Go Gin / Chi / Echo: r.GET("/api/v1/users", ...)
    re.compile(r'\.(?:GET|POST|PUT|DELETE|PATCH)\s*\(\s*["\'](/[^"\']+)["\']', re.IGNORECASE),
]

OUTBOUND_HTTP_PATTERNS = [
    # axios.get("http://service/api/..."), fetch("/api/...")
    re.compile(r'(?:axios|fetch|requests|http)\.(?:get|post|put|delete|patch|request)?\s*\(\s*["\'](https?://[^"\']+|/[a-zA-Z0-9_/-]+)["\']', re.IGNORECASE),
    # String literals starting with /api/
    re.compile(r'["\'](/api/v[0-9]+/[a-zA-Z0-9_/-]+)["\']', re.IGNORECASE),
]

TOPIC_PATTERNS = [
    # Kafka / RabbitMQ subscribe: topic: 'nte.trades.matched' or topics = ["nte.trades.matched"]
    re.compile(r'(?:topic|topics)\s*(?::|=)\s*["\']([a-zA-Z0-9._-]+)["\']', re.IGNORECASE),
    # Python/JS kafkajs subscribe({ topic: '...' })
    re.compile(r'subscribe\s*\(\s*\{\s*topic\s*:\s*["\']([a-zA-Z0-9._-]+)["\']', re.IGNORECASE),
    # KafkaListener: @KafkaListener(topics = "nte.trades.matched")
    re.compile(r'@KafkaListener\s*\(\s*topics\s*=\s*["\']([a-zA-Z0-9._-]+)["\']', re.IGNORECASE),
    # Domain topic conventions (e.g. nte.trades.matched, events.orders.created)
    re.compile(r'\b([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b'),
]

GRPC_PROTO_PATTERNS = [
    # service MarketDataService { ... }
    re.compile(r'service\s+([A-Za-z0-9_]+)\s*\{'),
    # rpc StreamTrades ( ... ) returns ( ... )
    re.compile(r'rpc\s+([A-Za-z0-9_]+)\s*\('),
]

INTERNAL_PACKAGE_PATTERNS = [
    # @myorg/client-sdk in package.json
    re.compile(r'["\'](@[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+)["\']'),
]


def extract_discovered_signatures(raw_content: str) -> dict[str, set[str]]:
    """Scan raw codebase contents for external interface signatures.
    
    Returns a dictionary of categorized identifiers:
      - 'rest_endpoints': ['/api/v1/auth/login', ...]
      - 'outbound_calls': ['/api/v1/auth/login', ...]
      - 'event_topics': ['nte.trades.matched', ...]
      - 'grpc_services': ['MarketDataService', ...]
      - 'packages': ['@myorg/auth-client', ...]
    """
    discovered: dict[str, set[str]] = {
        'rest_endpoints': set(),
        'outbound_calls': set(),
        'event_topics': set(),
        'grpc_services': set(),
        'packages': set(),
    }

    if not raw_content:
        return discovered

    # 1. REST Endpoints
    for pattern in REST_ROUTE_PATTERNS:
        for match in pattern.finditer(raw_content):
            route = match.group(1).strip()
            if len(route) > 2 and not route.endswith('.png') and not route.endswith('.jpg'):
                discovered['rest_endpoints'].add(route)

    # 2. Outbound HTTP Calls
    for pattern in OUTBOUND_HTTP_PATTERNS:
        for match in pattern.finditer(raw_content):
            url_or_path = match.group(1).strip()
            discovered['outbound_calls'].add(url_or_path)

    # 3. Event Topics (Kafka, RabbitMQ, etc.)
    code_extensions = ('.js', '.py', '.json', '.ts', '.txt', '.yaml', '.yml', '.go', '.html', '.css', '.md', '.log')
    for pattern in TOPIC_PATTERNS:
        for match in pattern.finditer(raw_content):
            topic = match.group(1).strip()
            if not any(topic.endswith(ext) for ext in code_extensions) and len(topic) > 4:
                discovered['event_topics'].add(topic)

    # 4. gRPC / Proto Definitions
    for pattern in GRPC_PROTO_PATTERNS:
        for match in pattern.finditer(raw_content):
            grpc_name = match.group(1).strip()
            discovered['grpc_services'].add(grpc_name)

    # 5. Internal Packages
    for pattern in INTERNAL_PACKAGE_PATTERNS:
        for match in pattern.finditer(raw_content):
            pkg = match.group(1).strip()
            discovered['packages'].add(pkg)

    return discovered


def get_all_searchable_identifiers(discovered: dict[str, set[str]]) -> list[str]:
    """Flattens all discovered signatures into a clean list of lookup identifiers."""
    all_identifiers = set()
    for category, items in discovered.items():
        for item in items:
            clean = item.strip()
            if clean:
                all_identifiers.add(clean)
                if clean.startswith('/'):
                    parts = [p for p in clean.split('/') if p and not p.startswith(':') and not p.startswith('{')]
                    if len(parts) >= 2:
                        all_identifiers.add('/' + '/'.join(parts[:3]))
    return sorted(list(all_identifiers))
