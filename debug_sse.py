import requests
import toml
import os

config = toml.load(os.path.expanduser('~/.snowflake/config.toml'))
conn = config['connections']['cpe_demo_CLI']
token = conn['password']
account = conn['account']
host = f"{account.lower()}.snowflakecomputing.com"

url = f"https://{host}/api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS/agents/CENTERPOINT_ENERGY_AGENT:run"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN"
}

payload = {
    "messages": [{"role": "user", "content": [{"type": "text", "text": "How many transformers are there?"}]}],
    "tool_choice": {"type": "auto"},
    "parent_message_id": 0
}

print("Sending request...")
with requests.post(url, json=payload, headers=headers, stream=True, timeout=120) as r:
    print(f"Status: {r.status_code}")
    for line in r.iter_lines(decode_unicode=True):
        if line:
            # Look for request_id in any event
            if 'request_id' in line.lower() or line.startswith('event:'):
                print(line)
