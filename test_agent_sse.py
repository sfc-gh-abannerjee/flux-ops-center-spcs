#!/usr/bin/env python3
"""
Test script to capture raw SSE events from Cortex Agent API
"""
import os
import json
import requests
import toml

# Load config
config_path = os.path.expanduser('~/.snowflake/config.toml')
config = toml.load(config_path)
conn_config = config['connections']['cpe_demo_CLI']

token = conn_config['password']
account = conn_config['account']
snowflake_host = f"{account.lower()}.snowflakecomputing.com"

agent_url = f"https://{snowflake_host}/api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS/agents/CENTERPOINT_ENERGY_AGENT:run"

# Test query that should generate SQL and table results
test_query = "What are the top 5 substations by load percentage?"

payload = {
    "messages": [{
        "role": "user",
        "content": [{"type": "text", "text": test_query}]
    }],
    "tool_choice": {"type": "auto"},
    "parent_message_id": 0
}

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN"
}

print(f"🚀 Sending query: {test_query}")
print(f"📡 Agent URL: {agent_url}")
print("=" * 80)

try:
    with requests.post(agent_url, json=payload, headers=headers, stream=True, timeout=120) as r:
        print(f"Response status: {r.status_code}")
        
        if r.status_code != 200:
            print(f"Error: {r.text[:1000]}")
        else:
            current_event = None
            event_count = 0
            
            for line in r.iter_lines(decode_unicode=True):
                if line:
                    if line.startswith('event: '):
                        current_event = line[7:]
                    elif line.startswith('data: '):
                        event_count += 1
                        data_str = line[6:]
                        
                        # Always print tool_result, table, chart events
                        if current_event in ['response.tool_result', 'response.table', 'response.chart', 'response']:
                            print(f"\n{'='*80}")
                            print(f"📦 EVENT #{event_count}: {current_event}")
                            print("-" * 80)
                            try:
                                data = json.loads(data_str)
                                print(json.dumps(data, indent=2)[:2000])
                                
                                # Extra detail for tool_result
                                if current_event == 'response.tool_result' and 'content' in data:
                                    print("\n🔍 CONTENT ITEMS:")
                                    for i, item in enumerate(data['content']):
                                        print(f"  [{i}] type={item.get('type')}")
                                        if item.get('type') == 'json':
                                            json_data = item.get('json', {})
                                            print(f"      keys: {list(json_data.keys())}")
                                            if 'sql' in json_data:
                                                print(f"      ✅ HAS SQL")
                                            if 'results' in json_data:
                                                print(f"      ✅ HAS RESULTS: {len(json_data['results'])} rows")
                                            if 'data' in json_data:
                                                print(f"      ✅ HAS DATA: {len(json_data['data'])} rows")
                            except json.JSONDecodeError:
                                print(f"Raw: {data_str[:500]}")
                        
                        # Print summary for text/thinking deltas
                        elif current_event in ['response.text.delta', 'response.thinking.delta']:
                            try:
                                data = json.loads(data_str)
                                text = data.get('text', '')[:50]
                                if text:
                                    print(f"  {current_event}: {text}...", end='\r')
                            except:
                                pass
                        
                        # Print status events
                        elif current_event == 'response.status':
                            try:
                                data = json.loads(data_str)
                                print(f"\n📊 Status: {data.get('message', data.get('status', ''))}")
                            except:
                                pass
                        
                        # Print any other events
                        else:
                            print(f"\n❓ Unknown event: {current_event}")
                            print(f"   Data: {data_str[:200]}")

            print(f"\n\n{'='*80}")
            print(f"✅ Stream complete. Total events: {event_count}")
            
except requests.exceptions.Timeout:
    print("❌ Request timed out")
except Exception as e:
    print(f"❌ Error: {e}")
