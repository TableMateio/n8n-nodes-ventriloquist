#!/usr/bin/env python3
"""
Contact Data Quality Comparison Tool
Compares Airtable vs IDI contact data for the same people
Provides scoring system and tracks differences for manual review
"""

import json
import os
from typing import Dict, List, Optional, Tuple
from datetime import datetime

class ContactDataComparator:
    def __init__(self):
        self.filtered_contacts = []
        self.idi_contacts = []
        self.idi_lookup = {}  # name_key -> contact
        self.comparison_results = []
        self.differences_log = []
        
    def normalize_name(self, first_name: str, last_name: str) -> str:
        """Create normalized name key for matching"""
        first = (first_name or "").strip().lower()
        last = (last_name or "").strip().lower()
        return f"{first}|{last}"
    
    def load_data(self, filtered_contacts_file: str, idi_contacts_file: str):
        """Load both contact datasets"""
        print(f"Loading filtered contacts from {filtered_contacts_file}")
        with open(filtered_contacts_file, 'r', encoding='utf-8') as file:
            self.filtered_contacts = json.load(file)
        
        print(f"Loading IDI contacts from {idi_contacts_file}")  
        with open(idi_contacts_file, 'r', encoding='utf-8') as file:
            self.idi_contacts = json.load(file)
        
        # Create IDI lookup by name
        for contact in self.idi_contacts:
            first_name = contact.get("First Name", "")
            last_name = contact.get("Last Name", "")
            if first_name or last_name:
                name_key = self.normalize_name(first_name, last_name)
                # If multiple people with same name, store as list
                if name_key in self.idi_lookup:
                    if not isinstance(self.idi_lookup[name_key], list):
                        self.idi_lookup[name_key] = [self.idi_lookup[name_key]]
                    self.idi_lookup[name_key].append(contact)
                else:
                    self.idi_lookup[name_key] = contact
        
        print(f"Loaded {len(self.filtered_contacts)} filtered contacts")
        print(f"Loaded {len(self.idi_contacts)} IDI contacts")
        print(f"Created lookup for {len(self.idi_lookup)} unique names")
    
    def find_idi_match(self, airtable_contact: Dict) -> Optional[Dict]:
        """Find matching IDI contact by name"""
        first_name = airtable_contact.get("First Name", "")
        last_name = airtable_contact.get("Last Name", "")
        name_key = self.normalize_name(first_name, last_name)
        
        match = self.idi_lookup.get(name_key)
        if match:
            # If multiple matches, return first one (could be improved with additional matching criteria)
            if isinstance(match, list):
                return match[0]
            return match
        return None
    
    def count_unique_relations(self, contact: Dict, contact_list: List[Dict]) -> int:
        """Count unique relations (different people) for this contact"""
        relations = contact.get("Relations", [])
        if not relations:
            return 0
        
        main_person_name = self.normalize_name(
            contact.get("First Name", ""),
            contact.get("Last Name", "")
        )
        
        unique_relations = set()
        for relation_id in relations:
            # Find the contact with this ID
            for other_contact in contact_list:
                if other_contact.get("ID") == relation_id:
                    other_name = self.normalize_name(
                        other_contact.get("First Name", ""),
                        other_contact.get("Last Name", "")
                    )
                    # Only count if it's a different person
                    if other_name != main_person_name and other_name:
                        unique_relations.add(other_name)
                    break
        
        return len(unique_relations)
    
    def calculate_score(self, contact: Dict, is_idi: bool = False) -> Dict:
        """Calculate completeness score for a contact"""
        score = 0
        details = []
        
        # 1 point for having Age
        if contact.get("Age") is not None:
            score += 1
            details.append("Has Age")
        
        # 1 point for having Deceased set to true (only when meaningful)
        if contact.get("Deceased") is True:
            score += 1
            details.append("Has Deceased=True")
        
        # 1 point for each address
        addresses = contact.get("Contact Addresses", []) or []
        address_count = len(addresses)
        score += address_count
        if address_count > 0:
            details.append(f"Has {address_count} address(es)")
        
        # 1 point for each unique relation
        if is_idi:
            relation_count = self.count_unique_relations(contact, self.idi_contacts)
        else:
            relation_count = self.count_unique_relations(contact, self.filtered_contacts)
        
        score += relation_count
        if relation_count > 0:
            details.append(f"Has {relation_count} unique relation(s)")
        
        return {
            "score": score,
            "details": details,
            "breakdown": {
                "has_age": contact.get("Age") is not None,
                "deceased_true": contact.get("Deceased") is True,
                "address_count": address_count,
                "relation_count": relation_count
            }
        }
    
    def track_differences(self, airtable_contact: Dict, idi_contact: Dict) -> Dict:
        """Track differences between contacts for manual review"""
        differences = {
            "name": f"{airtable_contact.get('First Name', '')} {airtable_contact.get('Last Name', '')}".strip(),
            "age_difference": None,
            "same_deceased": None,
            "same_bankruptcy": None,
            "airtable_relation_to_owner": airtable_contact.get("Relation to Owner"),
            "idi_relation_to_owner": idi_contact.get("Relation to Owner")
        }
        
        # Age difference
        airtable_age = airtable_contact.get("Age")
        idi_age = idi_contact.get("Age")
        if airtable_age is not None and idi_age is not None:
            differences["age_difference"] = abs(airtable_age - idi_age)
        elif airtable_age is not None:
            differences["age_difference"] = f"Airtable has {airtable_age}, IDI has None"
        elif idi_age is not None:
            differences["age_difference"] = f"IDI has {idi_age}, Airtable has None"
        else:
            differences["age_difference"] = "Both have None"
        
        # Deceased comparison
        airtable_deceased = airtable_contact.get("Deceased")
        idi_deceased = idi_contact.get("Deceased")
        differences["same_deceased"] = airtable_deceased == idi_deceased
        
        # Bankruptcy comparison
        airtable_bankruptcy = airtable_contact.get("Bankruptcy")
        idi_bankruptcy = idi_contact.get("Bankruptcy")
        differences["same_bankruptcy"] = airtable_bankruptcy == idi_bankruptcy
        
        return differences
    
    def compare_contacts(self):
        """Main comparison function"""
        print("Starting contact comparison...")
        
        traced_count = 0
        matched_count = 0
        
        for contact in self.filtered_contacts:
            # Only process if Traced is True
            if not contact.get("Traced"):
                continue
            
            traced_count += 1
            
            # Skip IDI contacts (we're comparing Airtable to IDI)
            if contact.get("_source") == "IDI":
                continue
            
            # Find matching IDI contact
            idi_match = self.find_idi_match(contact)
            if not idi_match:
                continue
            
            matched_count += 1
            
            # Calculate scores
            airtable_score = self.calculate_score(contact, is_idi=False)
            idi_score = self.calculate_score(idi_match, is_idi=True)
            
            # Track differences
            differences = self.track_differences(contact, idi_match)
            
            # Store comparison result
            result = {
                "name": differences["name"],
                "airtable_score": airtable_score,
                "idi_score": idi_score,
                "score_difference": idi_score["score"] - airtable_score["score"],  # Positive means IDI is better
                "winner": "IDI" if idi_score["score"] > airtable_score["score"] else 
                         "Airtable" if airtable_score["score"] > idi_score["score"] else "Tie"
            }
            
            self.comparison_results.append(result)
            self.differences_log.append(differences)
        
        print(f"Processed {traced_count} traced contacts")
        print(f"Found {matched_count} matches for comparison")
    
    def generate_report(self, output_file: str):
        """Generate comprehensive comparison report"""
        report = {
            "summary": self.generate_summary(),
            "detailed_comparisons": self.comparison_results,
            "differences_for_manual_review": self.differences_log,
            "generated_at": datetime.now().isoformat()
        }
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as file:
            json.dump(report, file, indent=2, ensure_ascii=False)
        
        print(f"Comparison report saved to {output_file}")
    
    def generate_summary(self) -> Dict:
        """Generate summary statistics"""
        if not self.comparison_results:
            return {"error": "No comparison results to summarize"}
        
        total_comparisons = len(self.comparison_results)
        
        # Score statistics
        airtable_scores = [r["airtable_score"]["score"] for r in self.comparison_results]
        idi_scores = [r["idi_score"]["score"] for r in self.comparison_results]
        
        # Winner statistics
        winners = {"IDI": 0, "Airtable": 0, "Tie": 0}
        for result in self.comparison_results:
            winners[result["winner"]] += 1
        
        # Average scores
        avg_airtable = sum(airtable_scores) / len(airtable_scores)
        avg_idi = sum(idi_scores) / len(idi_scores)
        
        return {
            "total_comparisons": total_comparisons,
            "average_scores": {
                "airtable": round(avg_airtable, 2),
                "idi": round(avg_idi, 2)
            },
            "score_ranges": {
                "airtable": {"min": min(airtable_scores), "max": max(airtable_scores)},
                "idi": {"min": min(idi_scores), "max": max(idi_scores)}
            },
            "winners": winners,
            "winner_percentages": {
                "idi": round(winners["IDI"] / total_comparisons * 100, 1),
                "airtable": round(winners["Airtable"] / total_comparisons * 100, 1),
                "tie": round(winners["Tie"] / total_comparisons * 100, 1)
            }
        }
    
    def print_summary(self):
        """Print summary to console"""
        summary = self.generate_summary()
        
        print("\n=== DATA QUALITY COMPARISON SUMMARY ===")
        print(f"Total Comparisons: {summary['total_comparisons']}")
        print(f"Average Airtable Score: {summary['average_scores']['airtable']}")
        print(f"Average IDI Score: {summary['average_scores']['idi']}")
        
        print(f"\nWinner Statistics:")
        print(f"  IDI Wins: {summary['winners']['IDI']} ({summary['winner_percentages']['idi']}%)")
        print(f"  Airtable Wins: {summary['winners']['Airtable']} ({summary['winner_percentages']['airtable']}%)")
        print(f"  Ties: {summary['winners']['Tie']} ({summary['winner_percentages']['tie']}%)")
        
        # Top performers
        print(f"\n=== TOP PERFORMERS ===")
        sorted_results = sorted(self.comparison_results, key=lambda x: x["score_difference"], reverse=True)
        
        print("IDI Significantly Better (top 5):")
        for result in sorted_results[:5]:
            if result["score_difference"] > 0:
                print(f"  {result['name']}: IDI={result['idi_score']['score']}, Airtable={result['airtable_score']['score']} (diff: +{result['score_difference']})")
        
        print("\nAirtable Significantly Better (top 5):")
        for result in sorted_results[-5:]:
            if result["score_difference"] < 0:
                print(f"  {result['name']}: Airtable={result['airtable_score']['score']}, IDI={result['idi_score']['score']} (diff: {result['score_difference']})")

def main():
    # File paths
    filtered_contacts_file = "Airtable_Converted_Data/Filtered_Contacts.json"
    idi_contacts_file = "IDI_Converted_Data/IDI_Contacts_Combined.json"
    output_file = "Airtable_Converted_Data/Data_Quality_Comparison_Report.json"
    
    # Check if input files exist
    if not os.path.exists(filtered_contacts_file):
        print(f"Error: {filtered_contacts_file} not found!")
        return
    
    if not os.path.exists(idi_contacts_file):
        print(f"Error: {idi_contacts_file} not found!")
        return
    
    # Create comparator and run analysis
    comparator = ContactDataComparator()
    comparator.load_data(filtered_contacts_file, idi_contacts_file)
    comparator.compare_contacts()
    comparator.generate_report(output_file)
    comparator.print_summary()

if __name__ == "__main__":
    main() 