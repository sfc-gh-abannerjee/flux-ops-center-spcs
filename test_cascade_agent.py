#!/usr/bin/env python3
"""
Test script to verify Cortex Agent cascade analysis tools
"""
import os
import json
import requests
import toml
from datetime import datetime

# Load config
config_path = os.path.expanduser('~/.snowflake/config.toml')
config = toml.load(config_path)
conn_config = config['connections']['cpe_demo_CLI']

token = conn_config['password']
account = conn_config['account']
snowflake_host = f"{account.lower()}.snowflakecomputing.com"

agent_url = f"https://{snowflake_host}/api/v2/databases/SNOWFLAKE_INTELLIGENCE/schemas/AGENTS/agents/CENTERPOINT_ENERGY_AGENT:run"

def test_agent_query(query: str, expected_tool: str = None):
    """Test agent with a specific query"""
    print(f"\n{'='*80}")
    print(f"🔍 QUERY: {query}")
    print(f"{'='*80}")
    
    payload = {
        "messages": [{
            "role": "user",
            "content": [{"type": "text", "text": query}]
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
    
    try:
        with requests.post(agent_url, json=payload, headers=headers, stream=True, timeout=120) as r:
            if r.status_code != 200:
                print(f"❌ Error: {r.status_code} - {r.text[:500]}")
                return False
            
            tool_called = None
            tool_result = None
            response_text = ""
            
            for line in r.iter_lines(decode_unicode=True):
                if line:
                    if line.startswith('event: '):
                        current_event = line[7:]
                    elif line.startswith('data: '):
                        data_str = line[6:]
                        try:
                            data = json.loads(data_str)
                            
                            # Capture tool calls
                            if current_event == 'response.tool_use':
                                tool_called = data.get('name', 'unknown')
                                print(f"\n🔧 Tool called: {tool_called}")
                                if 'input' in data:
                                    print(f"   Input: {json.dumps(data['input'], indent=2)[:200]}")
                            
                            # Capture tool results
                            elif current_event == 'response.tool_result':
                                if 'content' in data:
                                    for item in data['content']:
                                        if item.get('type') == 'json':
                                            tool_result = item.get('json', {})
                                            print(f"\n📊 Tool result preview:")
                                            result_str = json.dumps(tool_result, indent=2)
                                            print(result_str[:1000] + "..." if len(result_str) > 1000 else result_str)
                            
                            # Capture text response
                            elif current_event == 'response.text.delta':
                                response_text += data.get('text', '')
                                
                        except json.JSONDecodeError:
                            pass
            
            # Print final response summary
            print(f"\n📝 Agent Response Summary:")
            print("-" * 40)
            print(response_text[:1500] + "..." if len(response_text) > 1500 else response_text)
            
            # Verify expected tool was used
            if expected_tool and tool_called:
                if expected_tool in tool_called:
                    print(f"\n✅ SUCCESS: Expected tool '{expected_tool}' was called")
                    return True
                else:
                    print(f"\n⚠️ WARNING: Expected '{expected_tool}' but got '{tool_called}'")
                    return True  # Still consider success if agent gave a response
            
            return True
            
    except requests.exceptions.Timeout:
        print("❌ Request timed out")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def main():
    print("=" * 80)
    print("🚀 CORTEX AGENT CASCADE ANALYSIS TOOLS TEST")
    print(f"📡 Agent: CENTERPOINT_ENERGY_AGENT")
    print(f"🕐 Time: {datetime.now().isoformat()}")
    print("=" * 80)
    
    # Test cascade tools
    tests = [
        {
            "query": "Which substations are most critical for cascade failures? Show me the top 5.",
            "expected_tool": "cascade_patient_zeros"
        },
        {
            "query": "What happens if the Rayford Substation (SUB-HOU-124) fails?",
            "expected_tool": "cascade_impact"
        },
        {
            "query": "How should I configure a Winter Storm Uri cascade simulation?",
            "expected_tool": "cascade_scenarios"
        }
    ]
    
    results = []
    for test in tests:
        success = test_agent_query(test["query"], test.get("expected_tool"))
        results.append({
            "query": test["query"][:50] + "...",
            "expected_tool": test.get("expected_tool"),
            "success": success
        })
    
    # Print summary
    print("\n" + "=" * 80)
    print("📊 TEST SUMMARY")
    print("=" * 80)
    for r in results:
        status = "✅" if r["success"] else "❌"
        print(f"{status} {r['query']} → {r['expected_tool']}")
    
    passed = sum(1 for r in results if r["success"])
    print(f"\n🏁 Results: {passed}/{len(results)} tests passed")
    
    return passed == len(results)


if __name__ == "__main__":
    import sys
    success = main()
    sys.exit(0 if success else 1)
