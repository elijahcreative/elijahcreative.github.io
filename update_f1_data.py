#!/usr/bin/env python3
"""
F1 Auto-Update Script
Automatically updates standings.json and podiums.json after race weekends
Uses Jolpica F1 API (Ergast successor)
"""

import json
import requests
from datetime import datetime, timedelta
import sys
import time

# Configuration
JOLPICA_BASE_URL = "https://api.jolpi.ca/ergast/f1"
RACES_FILE = "F1/2023/Data/races.json"
STANDINGS_FILE = "F1/2023/Data/standings.json"
PODIUMS_FILE = "F1/2023/Data/podiums.json"

def fetch_with_retry(url, retries=3, delay=5, timeout=30):
    """Fetch URL with retry logic and exponential backoff"""
    for attempt in range(retries):
        try:
            print(f"📡 Fetching: {url} (attempt {attempt + 1}/{retries})")
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Attempt {attempt + 1} failed: {e}")
            if attempt < retries - 1:
                wait_time = delay * (2 ** attempt)
                print(f"⏳ Waiting {wait_time}s before retry...")
                time.sleep(wait_time)
    return None

def load_json(filepath):
    """Load JSON file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return None

def save_json(filepath, data):
    """Save JSON file with proper formatting"""
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved {filepath}")
        return True
    except Exception as e:
        print(f"❌ Error saving {filepath}: {e}")
        return False

def parse_race_date(date_str):
    """Parse race date from 'MMM DD YYYY HH:MM UTC' format"""
    try:
        return datetime.strptime(date_str, "%b %d %Y %H:%M UTC")
    except Exception as e:
        print(f"⚠️  Error parsing date '{date_str}': {e}")
        return None

def check_recent_race(races_data):
    """
    Check if there was a race in the last 24-48 hours
    Returns: (race_info, race_date) or (None, None)
    """
    now = datetime.utcnow()

    for race in races_data.get("Races", []):
        race_date_str = race.get("Race", "")
        race_date = parse_race_date(race_date_str)

        if not race_date:
            continue

        time_diff = now - race_date

        if timedelta(hours=0) <= time_diff <= timedelta(hours=48):
            print(f"🏁 Found recent race: {race['Country']} on {race_date_str}")
            return race, race_date

    print("ℹ️  No recent race found in the last 48 hours")
    return None, None

def get_latest_standings():
    """Fetch latest driver standings from Jolpica API"""
    url = f"{JOLPICA_BASE_URL}/current/driverStandings.json"
    data = fetch_with_retry(url)

    if not data:
        print("❌ Error fetching standings after all retries")
        return None

    try:
        standings_list = data['MRData']['StandingsTable']['StandingsLists'][0]['DriverStandings']
        print(f"✅ Retrieved {len(standings_list)} drivers")
        return standings_list
    except (KeyError, IndexError) as e:
        print(f"❌ Error parsing standings data: {e}")
        return None

def get_latest_race_results():
    """Fetch latest race results (podium) from Jolpica API"""
    url = f"{JOLPICA_BASE_URL}/current/last/results.json"
    data = fetch_with_retry(url)

    if not data:
        print("❌ Error fetching race results after all retries")
        return None, None

    try:
        race_info = data['MRData']['RaceTable']['Races'][0]
        results = race_info['Results'][:3]
        print(f"✅ Retrieved podium from: {race_info['raceName']}")
        return race_info, results
    except (KeyError, IndexError) as e:
        print(f"❌ Error parsing race results: {e}")
        return None, None

def extract_country_name(country_string):
    """
    Extract country name from format like '🇦🇺 Australia'
    Returns: 'Australia'
    """
    parts = country_string.split()
    name_parts = [p for p in parts if not any(char in p for char in '🇦🇧🇨🇩🇪🇫🇬🇭🇮🇯🇰🇱🇲🇳🇴🇵🇶🇷🇸🇹🇺🇻🇼🇽🇾🇿')]
    return ' '.join(name_parts)

def get_points_for_position(position):
    """Get points awarded for finishing position"""
    points_map = {
        1: 25, 2: 18, 3: 15, 4: 12, 5: 10,
        6: 8, 7: 6, 8: 4, 9: 2, 10: 1
    }
    return points_map.get(position, 0)

def update_standings_json(standings_data, race_info):
    """Update standings.json with latest championship standings"""

    country_full = race_info.get("Country", "")
    country_name = extract_country_name(country_full)

    standings_json = {
        "Standings": [
            {
                "After": f"After {country_name}"
            }
        ]
    }

    for driver in standings_data[:6]:
        driver_surname = driver['Driver']['familyName']
        team_name = driver['Constructors'][0]['name']
        points = driver['points']
        position = driver['position']

        standings_json["Standings"].append({
            "Place": position,
            "Name": driver_surname,
            "Team": team_name,
            "Points": points
        })

    return standings_json

def update_podiums_json(race_info, podium_results, standings_data):
    """Update podiums.json with latest race podium"""

    country_full = race_info.get("Country", "")
    city = race_info.get("City", "")

    race_number = "?"

    podiums_json = {
        "Podiums": [
            {
                "Country": country_full,
                "City": city,
                "Message": f"Race {race_number}"
            }
        ]
    }

    points_lookup = {}
    for driver in standings_data:
        surname = driver['Driver']['familyName']
        points_lookup[surname] = driver['points']

    for result in podium_results:
        position = result['position']
        driver_surname = result['Driver']['familyName']
        team_name = result['Constructor']['name']
        points_earned = get_points_for_position(int(position))
        total_points = points_lookup.get(driver_surname, "?")

        podiums_json["Podiums"].append({
            "Place": position,
            "Name": driver_surname,
            "Team": team_name,
            "Points": f"+{points_earned}",
            "Total": total_points
        })

    return podiums_json

def main():
    """Main execution"""
    print("=" * 60)
    print("🏎️  F1 Auto-Update Script")
    print("=" * 60)

    races_data = load_json(RACES_FILE)
    if not races_data:
        print("❌ Failed to load races.json")
        sys.exit(1)

    race_info, race_date = check_recent_race(races_data)

    if not race_info:
        print("ℹ️  No update needed - no recent race found")
        sys.exit(0)

    print(f"\n🏁 Race detected! Updating results for: {race_info['Country']}")
    print(f"   City: {race_info['City']}")
    print(f"   Date: {race_date}")

    print("\n📊 Fetching data from Jolpica F1 API...")
    standings_data = get_latest_standings()
    race_result_info, podium_results = get_latest_race_results()

    if not standings_data or not podium_results:
        print("❌ Failed to fetch data from API")
        sys.exit(1)

    print("\n📝 Updating standings.json...")
    new_standings = update_standings_json(standings_data, race_info)
    if save_json(STANDINGS_FILE, new_standings):
        print("✅ standings.json updated successfully")

    print("\n🏆 Updating podiums.json...")
    new_podiums = update_podiums_json(race_info, podium_results, standings_data)
    if save_json(PODIUMS_FILE, new_podiums):
        print("✅ podiums.json updated successfully")

    print("\n" + "=" * 60)
    print("✅ Update complete!")
    print("=" * 60)

if __name__ == "__main__":
    main()
