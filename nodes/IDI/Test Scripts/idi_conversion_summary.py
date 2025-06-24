#!/usr/bin/env python3
"""
IDI Conversion Summary Report
Analyzes the converted IDI JSON data and provides insights
"""

import json
from collections import Counter, defaultdict

def analyze_idi_conversion():
    """Generate a comprehensive summary of the IDI conversion results"""
    
    # Load both converted files
    files = [
        ("IDI_Contacts_Batch Template_out.json", "Batch Template_out"),
        ("IDI_Contacts_Batch Template No Address_out.json", "Batch Template No Address_out")
    ]
    
    total_stats = {
        "total_contacts": 0,
        "total_addresses": 0,
        "primary_contacts": 0,
        "relatives": 0,
        "relations_per_primary": [],
        "addresses_per_contact": [],
        "relationship_types": Counter(),
        "age_distribution": [],
        "phone_numbers": 0,
        "emails": 0,
        "deceased_count": 0,
        "bankruptcy_count": 0,
        "states": Counter(),
        "counties": Counter()
    }
    
    print("📊 IDI CONVERSION SUMMARY REPORT")
    print("=" * 50)
    
    for contacts_file, name in files:
        print(f"\n🔍 ANALYZING: {name}")
        print("-" * 30)
        
        try:
            # Load contacts
            with open(contacts_file, 'r') as f:
                contacts = json.load(f)
            
            # Load addresses
            addresses_file = contacts_file.replace('.json', '_addresses.json')
            with open(addresses_file, 'r') as f:
                addresses = json.load(f)
            
            # File-specific stats
            file_stats = analyze_file(contacts, addresses)
            
            # Print file summary
            print(f"📈 Contacts: {file_stats['total_contacts']}")
            print(f"📈 Addresses: {file_stats['total_addresses']}")
            print(f"👤 Primary contacts: {file_stats['primary_contacts']}")
            print(f"👥 Relatives: {file_stats['relatives']}")
            print(f"📞 Phone numbers: {file_stats['phone_numbers']}")
            print(f"📧 Email addresses: {file_stats['emails']}")
            print(f"⚰️  Deceased: {file_stats['deceased_count']}")
            print(f"💰 Bankruptcy: {file_stats['bankruptcy_count']}")
            
            # Top relationship types
            if file_stats['relationship_types']:
                print(f"\n📋 Top Relationship Types:")
                for rel_type, count in file_stats['relationship_types'].most_common(5):
                    print(f"   • {rel_type}: {count}")
            
            # Top states
            if file_stats['states']:
                print(f"\n🗺️  Top States:")
                for state, count in file_stats['states'].most_common(5):
                    print(f"   • {state}: {count}")
            
            # Accumulate totals
            for key in ['total_contacts', 'total_addresses', 'primary_contacts', 'relatives', 
                       'phone_numbers', 'emails', 'deceased_count', 'bankruptcy_count']:
                total_stats[key] += file_stats[key]
            
            total_stats['relations_per_primary'].extend(file_stats['relations_per_primary'])
            total_stats['addresses_per_contact'].extend(file_stats['addresses_per_contact'])
            total_stats['age_distribution'].extend(file_stats['age_distribution'])
            total_stats['relationship_types'].update(file_stats['relationship_types'])
            total_stats['states'].update(file_stats['states'])
            total_stats['counties'].update(file_stats['counties'])
            
        except Exception as e:
            print(f"❌ Error analyzing {name}: {e}")
    
    # Overall summary
    print(f"\n🎯 OVERALL SUMMARY")
    print("=" * 30)
    print(f"📈 Total contacts: {total_stats['total_contacts']}")
    print(f"📈 Total addresses: {total_stats['total_addresses']}")
    print(f"👤 Primary contacts: {total_stats['primary_contacts']}")
    print(f"👥 Total relatives: {total_stats['relatives']}")
    
    # Calculate averages
    if total_stats['primary_contacts'] > 0:
        avg_relatives = total_stats['relatives'] / total_stats['primary_contacts']
        print(f"👥 Average relatives per primary: {avg_relatives:.1f}")
    
    if total_stats['relations_per_primary']:
        avg_relations = sum(total_stats['relations_per_primary']) / len(total_stats['relations_per_primary'])
        print(f"🔗 Average relations per primary: {avg_relations:.1f}")
    
    if total_stats['addresses_per_contact']:
        avg_addresses = sum(total_stats['addresses_per_contact']) / len(total_stats['addresses_per_contact'])
        print(f"🏠 Average addresses per contact: {avg_addresses:.1f}")
    
    # Data quality metrics
    print(f"\n📊 DATA QUALITY METRICS")
    print("-" * 25)
    phone_rate = (total_stats['phone_numbers'] / total_stats['total_contacts'] * 100) if total_stats['total_contacts'] > 0 else 0
    print(f"📞 Phone coverage: {phone_rate:.1f}%")
    
    email_rate = (total_stats['emails'] / total_stats['total_contacts'] * 100) if total_stats['total_contacts'] > 0 else 0
    print(f"📧 Email coverage: {email_rate:.1f}%")
    
    address_rate = (total_stats['total_addresses'] / total_stats['total_contacts'] * 100) if total_stats['total_contacts'] > 0 else 0
    print(f"🏠 Address coverage: {address_rate:.1f}%")
    
    # Age distribution
    if total_stats['age_distribution']:
        ages = [age for age in total_stats['age_distribution'] if age > 0]
        if ages:
            avg_age = sum(ages) / len(ages)
            print(f"📅 Average age: {avg_age:.1f} years")
            print(f"📅 Age range: {min(ages)} - {max(ages)} years")
    
    # Top relationship types overall
    print(f"\n🤝 TOP RELATIONSHIP TYPES")
    print("-" * 25)
    for rel_type, count in total_stats['relationship_types'].most_common(10):
        print(f"   • {rel_type}: {count}")
    
    # Geographic distribution
    print(f"\n🗺️  GEOGRAPHIC DISTRIBUTION")
    print("-" * 27)
    print("Top States:")
    for state, count in total_stats['states'].most_common(5):
        print(f"   • {state}: {count}")
    
    print("\nTop Counties:")
    for county, count in total_stats['counties'].most_common(5):
        print(f"   • {county}: {count}")
    
    return total_stats

def analyze_file(contacts, addresses):
    """Analyze a single file's data"""
    stats = {
        "total_contacts": len(contacts),
        "total_addresses": len(addresses),
        "primary_contacts": 0,
        "relatives": 0,
        "relations_per_primary": [],
        "addresses_per_contact": [],
        "relationship_types": Counter(),
        "age_distribution": [],
        "phone_numbers": 0,
        "emails": 0,
        "deceased_count": 0,
        "bankruptcy_count": 0,
        "states": Counter(),
        "counties": Counter()
    }
    
    for contact in contacts:
        # Count primary vs relatives
        relation = contact.get("Relation to Owner", "")
        if relation == "Owner":
            stats["primary_contacts"] += 1
            # Count relations for primary contacts
            relations_count = len(contact.get("Relations", []))
            stats["relations_per_primary"].append(relations_count)
        else:
            stats["relatives"] += 1
            stats["relationship_types"][relation] += 1
        
        # Count addresses per contact
        address_count = len(contact.get("Contact Addresses", []))
        stats["addresses_per_contact"].append(address_count)
        
        # Count data quality indicators
        if contact.get("Phone"):
            stats["phone_numbers"] += 1
        
        if contact.get("Email"):
            stats["emails"] += 1
        
        if contact.get("Deceased"):
            stats["deceased_count"] += 1
        
        if contact.get("Bankruptcy"):
            stats["bankruptcy_count"] += 1
        
        # Age distribution
        age = contact.get("Age", 0)
        if age:
            stats["age_distribution"].append(age)
    
    # Geographic distribution from addresses
    for address in addresses:
        state = address.get("State", "")
        county = address.get("County", "")
        
        if state:
            stats["states"][state] += 1
        if county:
            stats["counties"][county] += 1
    
    return stats

if __name__ == "__main__":
    analyze_idi_conversion() 