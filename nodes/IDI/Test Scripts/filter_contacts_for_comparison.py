#!/usr/bin/env python3
"""
Contact Filter for IDI Comparison
Takes Airtable Contacts.json and IDI_Contacts_Combined.json
Creates filtered dataset containing:
- ALL contacts from IDI_Contacts_Combined.json
- Only Airtable contacts that match IDI contacts (by name) or have relations to IDI contacts
"""

import json
import os
from typing import Dict, List, Set, Tuple

class ContactFilter:
    def __init__(self):
        self.idi_contacts = []
        self.airtable_contacts = []
        self.idi_name_set = set()
        self.filtered_contacts = []
        
    def normalize_name(self, first_name: str, last_name: str) -> str:
        """Create normalized name key for matching"""
        first = (first_name or "").strip().lower()
        last = (last_name or "").strip().lower()
        return f"{first}|{last}"
    
    def load_idi_contacts(self, file_path: str):
        """Load IDI contacts and create name lookup set"""
        print(f"Loading IDI contacts from {file_path}")
        
        with open(file_path, 'r', encoding='utf-8') as file:
            self.idi_contacts = json.load(file)
        
        # Create set of normalized names from IDI contacts
        for contact in self.idi_contacts:
            first_name = contact.get("First Name", "")
            last_name = contact.get("Last Name", "")
            if first_name or last_name:
                name_key = self.normalize_name(first_name, last_name)
                self.idi_name_set.add(name_key)
        
        print(f"Loaded {len(self.idi_contacts)} IDI contacts")
        print(f"Created {len(self.idi_name_set)} unique name keys from IDI data")
    
    def load_airtable_contacts(self, file_path: str):
        """Load Airtable contacts"""
        print(f"Loading Airtable contacts from {file_path}")
        
        with open(file_path, 'r', encoding='utf-8') as file:
            self.airtable_contacts = json.load(file)
        
        print(f"Loaded {len(self.airtable_contacts)} Airtable contacts")
    
    def contact_matches_idi(self, contact: Dict) -> bool:
        """Check if an Airtable contact matches any IDI contact by name"""
        first_name = contact.get("First Name", "")
        last_name = contact.get("Last Name", "")
        
        if not first_name and not last_name:
            return False
            
        name_key = self.normalize_name(first_name, last_name)
        return name_key in self.idi_name_set
    
    def contact_has_idi_relations(self, contact: Dict) -> Tuple[bool, List[str]]:
        """Check if any of this contact's relations match IDI contacts"""
        relations = contact.get("Relations", [])
        if not relations:
            return False, []
        
        # Relations might be contact IDs, so we need to look up the actual contacts
        matching_relations = []
        
        # Find contacts by their Relations field (which should contain IDs)
        for relation_id in relations:
            # Look for contacts in airtable_contacts that have this ID
            for related_contact in self.airtable_contacts:
                if related_contact.get("ID") == relation_id:
                    # Check if this related contact matches IDI
                    if self.contact_matches_idi(related_contact):
                        related_name = f"{related_contact.get('First Name', '')} {related_contact.get('Last Name', '')}".strip()
                        matching_relations.append(related_name)
        
        return len(matching_relations) > 0, matching_relations
    
    def filter_contacts(self):
        """Create filtered contact list"""
        print("Filtering contacts...")
        
        # Start with ALL IDI contacts
        self.filtered_contacts = self.idi_contacts.copy()
        print(f"Added {len(self.idi_contacts)} IDI contacts to filtered list")
        
        # Add matching Airtable contacts
        airtable_matches = 0
        airtable_relation_matches = 0
        
        for contact in self.airtable_contacts:
            include_contact = False
            reason = ""
            
            # Check direct name match
            if self.contact_matches_idi(contact):
                include_contact = True
                reason = "Direct name match"
                airtable_matches += 1
            else:
                # Check if any relations match IDI contacts
                has_idi_relations, matching_relations = self.contact_has_idi_relations(contact)
                if has_idi_relations:
                    include_contact = True
                    reason = f"Related to IDI contacts: {', '.join(matching_relations)}"
                    airtable_relation_matches += 1
            
            if include_contact:
                # Add source identifier to distinguish from IDI contacts
                contact_copy = contact.copy()
                contact_copy["_source"] = "Airtable"
                contact_copy["_match_reason"] = reason
                self.filtered_contacts.append(contact_copy)
        
        # Add source identifier to IDI contacts
        for contact in self.filtered_contacts[:len(self.idi_contacts)]:
            contact["_source"] = "IDI"
            contact["_match_reason"] = "IDI source data"
        
        print(f"Added {airtable_matches} Airtable contacts with direct name matches")
        print(f"Added {airtable_relation_matches} Airtable contacts with IDI relations")
        print(f"Total filtered contacts: {len(self.filtered_contacts)}")
    
    def save_filtered_contacts(self, output_path: str):
        """Save filtered contacts to JSON file"""
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as file:
            json.dump(self.filtered_contacts, file, indent=2, ensure_ascii=False)
        
        print(f"Saved filtered contacts to {output_path}")
    
    def print_summary(self):
        """Print summary of filtering results"""
        print("\n=== FILTERING SUMMARY ===")
        
        idi_count = len([c for c in self.filtered_contacts if c.get("_source") == "IDI"])
        airtable_count = len([c for c in self.filtered_contacts if c.get("_source") == "Airtable"])
        
        print(f"IDI Contacts: {idi_count}")
        print(f"Airtable Contacts: {airtable_count}")
        print(f"Total Contacts: {len(self.filtered_contacts)}")
        
        # Show some examples of matches
        print("\n=== SAMPLE MATCHES ===")
        sample_count = 0
        for contact in self.filtered_contacts:
            if contact.get("_source") == "Airtable" and sample_count < 5:
                name = f"{contact.get('First Name', '')} {contact.get('Last Name', '')}".strip()
                reason = contact.get("_match_reason", "")
                print(f"  {name}: {reason}")
                sample_count += 1

def main():
    # File paths
    idi_contacts_file = "IDI_Converted_Data/IDI_Contacts_Combined.json"
    airtable_contacts_file = "Airtable/Contacts.json"
    output_file = "Airtable_Converted_Data/Filtered_Contacts.json"
    
    # Check if input files exist
    if not os.path.exists(idi_contacts_file):
        print(f"Error: {idi_contacts_file} not found!")
        return
    
    if not os.path.exists(airtable_contacts_file):
        print(f"Error: {airtable_contacts_file} not found!")
        return
    
    # Create filter and process
    filter_tool = ContactFilter()
    filter_tool.load_idi_contacts(idi_contacts_file)
    filter_tool.load_airtable_contacts(airtable_contacts_file)
    filter_tool.filter_contacts()
    filter_tool.save_filtered_contacts(output_file)
    filter_tool.print_summary()

if __name__ == "__main__":
    main() 