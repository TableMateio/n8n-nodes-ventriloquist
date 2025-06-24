#!/usr/bin/env python3
"""
Test Airtable Integration with 3 Contacts
"""

import json
import os
from update_airtable_with_idi_data import AirtableIDIUpdater

def deduplicate_contacts(contacts_with_depth):
    """Remove duplicate contacts from the processing list"""
    seen_contacts = {}
    deduplicated = []
    
    for contact, depth in contacts_with_depth:
        first_name = (contact.get('First Name') or '').strip()
        last_name = (contact.get('Last Name') or '').strip()
        middle_name = (contact.get('Middle Name') or '').strip()
        suffix = (contact.get('Suffix') or '').strip()
        age = contact.get('Age')
        
        # Create a key for comparison
        key = f"{first_name.lower()}|{last_name.lower()}"
        
        if key in seen_contacts:
            # Check if it's really the same person
            existing_contact, existing_depth = seen_contacts[key]
            
            existing_middle = (existing_contact.get('Middle Name') or '').strip()
            existing_suffix = (existing_contact.get('Suffix') or '').strip()
            existing_age = existing_contact.get('Age')
            
            # Different suffixes = different people (Jr/Sr)
            if suffix and existing_suffix and suffix.lower() != existing_suffix.lower():
                print(f"   Keeping both: {first_name} {last_name} (different suffixes: '{suffix}' vs '{existing_suffix}')")
                deduplicated.append((contact, depth))
                continue
            
            # Significant age difference = different people
            if age and existing_age and abs(age - existing_age) > 2:
                print(f"   Keeping both: {first_name} {last_name} (age difference: {age} vs {existing_age})")
                deduplicated.append((contact, depth))
                continue
            
            # Same person - merge the data and keep the one with more info
            print(f"   Duplicate found: {first_name} {last_name}")
            
            # Prioritize Owner over other relations
            current_relation = contact.get("Relation to Owner", "").strip().lower()
            existing_relation = existing_contact.get("Relation to Owner", "").strip().lower()
            
            if current_relation == "owner" and existing_relation != "owner":
                print(f"     Replacing with Owner record (Owner vs {existing_relation})")
                # Replace the existing one
                for i, (stored_contact, stored_depth) in enumerate(deduplicated):
                    if stored_contact == existing_contact:
                        deduplicated[i] = (contact, depth)
                        break
                seen_contacts[key] = (contact, depth)
            elif existing_relation == "owner" and current_relation != "owner":
                print(f"     Keeping existing Owner record (Owner vs {current_relation})")
            else:
                # Both same relation level, use field count
                current_fields = sum(1 for v in contact.values() if v and v != '')
                existing_fields = sum(1 for v in existing_contact.values() if v and v != '')
                
                if current_fields > existing_fields:
                    print(f"     Replacing with more complete record ({current_fields} vs {existing_fields} fields)")
                    # Replace the existing one
                    for i, (stored_contact, stored_depth) in enumerate(deduplicated):
                        if stored_contact == existing_contact:
                            deduplicated[i] = (contact, depth)
                            break
                    seen_contacts[key] = (contact, depth)
                else:
                    print(f"     Keeping existing record ({existing_fields} vs {current_fields} fields)")
        else:
            # First time seeing this person
            seen_contacts[key] = (contact, depth)
            deduplicated.append((contact, depth))
    
    return deduplicated

def test_5_contacts():
    API_TOKEN = "patPlJs2npm1zcFDw.451fb983e05c30333083d0a788ca4466a94217f66f41eb74f713f15068cc354b"
    BASE_ID = "appZMhZh6hDrzAnuV"
    
    # Load IDI contacts
    idi_contacts_file = "IDI_Converted_Data/IDI_Contacts_Combined.json"
    
    print(f"Loading IDI contacts from {idi_contacts_file}")
    with open(idi_contacts_file, 'r', encoding='utf-8') as file:
        idi_contacts = json.load(file)
    
    print(f"Total contacts available: {len(idi_contacts)}")
    
    # Create updater
    updater = AirtableIDIUpdater(API_TOKEN, BASE_ID)
    
    # Create a mapping of ID to contact for quick lookup
    contact_by_id = {contact['ID']: contact for contact in idi_contacts}
    
    # Select 5 interesting contacts including some we've already processed
    # Include Harris family members + some new ones for variety
    target_ids = [
        9,  # Christopher Harris (Owner) - the MAIN owner with relations
        4,  # Courtney Harris (Spouse) - already processed  
        6,  # Latoya Pickett (Spouse) - already processed
        7,  # Walter Harris (Parent) - already processed
        8   # Phoenix Harris (Child) - already processed
    ]
    
    initial_contacts = []
    for target_id in target_ids:
        contact = next((c for c in idi_contacts if c['ID'] == target_id), None)
        if contact:
            initial_contacts.append(contact)
    
    print(f"🎯 Selected 5 contacts for testing (mix of processed and new):")
    for i, contact in enumerate(initial_contacts):
        name = f"{contact.get('First Name', '')} {contact.get('Last Name', '')}"
        relation = contact.get('Relation to Owner', 'N/A')
        addresses = len(contact.get('Contact Addresses', []))
        relations = len(contact.get('Relations', []))
        print(f"   {i+1}. {name} ({relation}) - {addresses} addresses, {relations} relations")
    contacts_to_process = []
    processed_ids = set()
    
    def add_contact_and_relations(contact, depth=0, max_depth=2):
        """Recursively add contact and their relations"""
        contact_id = contact['ID']
        
        if contact_id in processed_ids or depth > max_depth:
            return
            
        processed_ids.add(contact_id)
        contacts_to_process.append((contact, depth))
        
        # Add all related contacts
        relations = contact.get('Relations', [])
        if relations:
            print(f"{'  ' * depth}→ Found {len(relations)} relations for {contact.get('First Name', '')} {contact.get('Last Name', '')}")
            for relation_id in relations:
                if relation_id in contact_by_id:
                    add_contact_and_relations(contact_by_id[relation_id], depth + 1, max_depth)
    
    print("\n" + "="*70)
    print("DISCOVERING CONTACT NETWORK (Harris Family + all relations)")
    print("="*70)
    
    # Build the contact network
    for i, contact in enumerate(initial_contacts):
        print(f"\n🔍 Analyzing Contact {i+1}: {contact.get('First Name', '')} {contact.get('Last Name', '')}")
        add_contact_and_relations(contact)
    
    print(f"\n📊 NETWORK DISCOVERY COMPLETE:")
    print(f"   Total contacts discovered: {len(contacts_to_process)}")
    
    # Deduplicate contacts in the batch
    print(f"\n🔍 DEDUPLICATING CONTACTS...")
    original_count = len(contacts_to_process)
    contacts_to_process = deduplicate_contacts(contacts_to_process)
    dedupe_count = original_count - len(contacts_to_process)
    
    print(f"   Removed {dedupe_count} duplicates")
    print(f"   Final contacts to process: {len(contacts_to_process)}")
    print(f"   Network includes relations up to 2 degrees deep")
    
    # Process all contacts in the network using two-pass approach
    print("\n" + "="*70)
    print("PROCESSING COMPLETE CONTACT NETWORK (Two-Pass Approach)")
    print("="*70)
    
    # PASS 1: Create/update all contacts without relations
    print("\n🔄 PASS 1: Creating/updating contacts...")
    contact_id_mapping = {}  # Map IDI ID → Airtable Record ID
    success_count = 0
    
    for i, (contact, depth) in enumerate(contacts_to_process):
        indent = "  " * depth
        relationship_type = "🏠 PRIMARY" if depth == 0 else f"👥 RELATION (Level {depth})"
        
        print(f"\n{indent}--- CONTACT {i+1}/{len(contacts_to_process)} - {relationship_type} ---")
        print(f"{indent}Name: {contact.get('First Name', '')} {contact.get('Last Name', '')}")
        print(f"{indent}ID: {contact.get('ID')}")
        print(f"{indent}Age: {contact.get('Age', 'N/A')}")
        print(f"{indent}Phone: {contact.get('Phone', 'N/A')}")
        print(f"{indent}Email: {contact.get('Email', 'N/A')}")
        print(f"{indent}Addresses: {len(contact.get('Contact Addresses', []))}")
        print(f"{indent}Relations: {len(contact.get('Relations', []))}")
        print(f"{indent}Relation to Owner: {contact.get('Relation to Owner', 'N/A')}")
        
        # Process the contact (without relations for now)
        # Convert contacts_to_process to just the contact list for the all_idi_contacts parameter
        all_contacts = [c for c, _ in contacts_to_process]
        contact_record_id = updater.update_or_create_contact(contact, None, all_contacts)
        
        if contact_record_id:
            print(f"{indent}✅ SUCCESS: Contact processed with ID {contact_record_id}")
            contact_id_mapping[contact['ID']] = contact_record_id
            success_count += 1
        else:
            print(f"{indent}❌ FAILED: Could not process contact")
        
        print(f"{indent}" + "-" * 40)
    
    # PASS 2: Update contacts with relations (bidirectional)
    print(f"\n🔗 PASS 2: Setting up bidirectional relationships...")
    print(f"Contact ID mapping: {contact_id_mapping}")
    
    relations_updated = updater.update_bidirectional_relations(contacts_to_process, contact_id_mapping)
    
    print(f"\n📊 Relations Summary: {relations_updated} contacts had their relations updated")
    
    print(f"\n🎉 NETWORK PROCESSING SUMMARY:")
    print(f"   Successfully processed: {success_count}/{len(contacts_to_process)} contacts")
    print(f"   Failed: {len(contacts_to_process) - success_count}/{len(contacts_to_process)} contacts")
    print(f"   Network depth: Up to 2 relationship levels")
    
    # Show relationship breakdown
    primary_count = sum(1 for _, depth in contacts_to_process if depth == 0)
    level1_count = sum(1 for _, depth in contacts_to_process if depth == 1)
    level2_count = sum(1 for _, depth in contacts_to_process if depth == 2)
    
    print(f"\n📈 RELATIONSHIP BREAKDOWN:")
    print(f"   Primary contacts: {primary_count}")
    print(f"   Level 1 relations: {level1_count}")
    print(f"   Level 2 relations: {level2_count}")

if __name__ == "__main__":
    test_5_contacts() 