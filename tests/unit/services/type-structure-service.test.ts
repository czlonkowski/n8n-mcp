/**
 * Tests for TypeStructureService
 *
 * @group unit
 * @group services
 */

import { describe, it, expect } from 'vitest';
import { TypeStructureService } from '@/services/type-structure-service';
import type { NodePropertyTypes } from 'n8n-workflow';

describe('TypeStructureService', () => {
	describe('getStructure', () => {
		it('should return structure for valid types', () => {
			const types: NodePropertyTypes[] = [
				'string',
				'number',
				'collection',
				'filter',
			];

			for (const type of types) {
				const structure = TypeStructureService.getStructure(type);
				expect(structure).not.toBeNull();
				expect(structure!.type).toBeDefined();
				expect(structure!.jsType).toBeDefined();
			}
		});

		it('should return null for unknown types', () => {
			const structure = TypeStructureService.getStructure('unknown' as NodePropertyTypes);
			expect(structure).toBeNull();
		});

		it('should return correct structure for string type', () => {
			const structure = TypeStructureService.getStructure('string');
			expect(structure).not.toBeNull();
			expect(structure!.type).toBe('primitive');
			expect(structure!.jsType).toBe('string');
			expect(structure!.description).toContain('text');
		});

		it('should return correct structure for collection type', () => {
			const structure = TypeStructureService.getStructure('collection');
			expect(structure).not.toBeNull();
			expect(structure!.type).toBe('collection');
			expect(structure!.jsType).toBe('object');
			expect(structure!.structure).toBeDefined();
		});

		it('should return correct structure for filter type', () => {
			const structure = TypeStructureService.getStructure('filter');
			expect(structure).not.toBeNull();
			expect(structure!.type).toBe('special');
			expect(structure!.structure?.properties?.conditions).toBeDefined();
			expect(structure!.structure?.properties?.combinator).toBeDefined();
		});
	});

	describe('getAllStructures', () => {
		it('should return all 22 type structures', () => {
			const structures = TypeStructureService.getAllStructures();
			expect(Object.keys(structures)).toHaveLength(22);
		});

		it('should return a copy not a reference', () => {
			const structures1 = TypeStructureService.getAllStructures();
			const structures2 = TypeStructureService.getAllStructures();
			expect(structures1).not.toBe(structures2);
		});

		it('should include all expected types', () => {
			const structures = TypeStructureService.getAllStructures();
			const expectedTypes = [
				'string',
				'number',
				'boolean',
				'collection',
				'filter',
			];

			for (const type of expectedTypes) {
				expect(structures).toHaveProperty(type);
			}
		});
	});

	describe('getExample', () => {
		it('should return example for valid types', () => {
			const types: NodePropertyTypes[] = [
				'string',
				'number',
				'boolean',
				'collection',
			];

			for (const type of types) {
				const example = TypeStructureService.getExample(type);
				expect(example).toBeDefined();
			}
		});

		it('should return null for unknown types', () => {
			const example = TypeStructureService.getExample('unknown' as NodePropertyTypes);
			expect(example).toBeNull();
		});

		it('should return string for string type', () => {
			const example = TypeStructureService.getExample('string');
			expect(typeof example).toBe('string');
		});

		it('should return number for number type', () => {
			const example = TypeStructureService.getExample('number');
			expect(typeof example).toBe('number');
		});

		it('should return boolean for boolean type', () => {
			const example = TypeStructureService.getExample('boolean');
			expect(typeof example).toBe('boolean');
		});

		it('should return object for collection type', () => {
			const example = TypeStructureService.getExample('collection');
			expect(typeof example).toBe('object');
			expect(example).not.toBeNull();
		});

		it('should return array for multiOptions type', () => {
			const example = TypeStructureService.getExample('multiOptions');
			expect(Array.isArray(example)).toBe(true);
		});

		it('should return valid filter example', () => {
			const example = TypeStructureService.getExample('filter');
			expect(example).toHaveProperty('conditions');
			expect(example).toHaveProperty('combinator');
		});
	});

	describe('getExamples', () => {
		it('should return array of examples', () => {
			const examples = TypeStructureService.getExamples('string');
			expect(Array.isArray(examples)).toBe(true);
			expect(examples.length).toBeGreaterThan(0);
		});

		it('should return empty array for unknown types', () => {
			const examples = TypeStructureService.getExamples('unknown' as NodePropertyTypes);
			expect(examples).toEqual([]);
		});

		it('should return multiple examples when available', () => {
			const examples = TypeStructureService.getExamples('string');
			expect(examples.length).toBeGreaterThan(1);
		});

		it('should return single example array when no examples array exists', () => {
			// Some types might not have multiple examples
			const examples = TypeStructureService.getExamples('button');
			expect(Array.isArray(examples)).toBe(true);
		});
	});

	describe('isComplexType', () => {
		it('should identify complex types correctly', () => {
			const complexTypes: NodePropertyTypes[] = [
				'collection',
				'fixedCollection',
				'resourceLocator',
				'resourceMapper',
				'filter',
				'assignmentCollection',
			];

			for (const type of complexTypes) {
				expect(TypeStructureService.isComplexType(type)).toBe(true);
			}
		});

		it('should return false for non-complex types', () => {
			const nonComplexTypes: NodePropertyTypes[] = [
				'string',
				'number',
				'boolean',
				'options',
				'multiOptions',
			];

			for (const type of nonComplexTypes) {
				expect(TypeStructureService.isComplexType(type)).toBe(false);
			}
		});
	});

	describe('isPrimitiveType', () => {
		it('should identify primitive types correctly', () => {
			const primitiveTypes: NodePropertyTypes[] = [
				'string',
				'number',
				'boolean',
				'dateTime',
				'color',
				'json',
			];

			for (const type of primitiveTypes) {
				expect(TypeStructureService.isPrimitiveType(type)).toBe(true);
			}
		});

		it('should return false for non-primitive types', () => {
			const nonPrimitiveTypes: NodePropertyTypes[] = [
				'collection',
				'fixedCollection',
				'options',
				'filter',
			];

			for (const type of nonPrimitiveTypes) {
				expect(TypeStructureService.isPrimitiveType(type)).toBe(false);
			}
		});
	});

	describe('getComplexTypes', () => {
		it('should return array of complex types', () => {
			const complexTypes = TypeStructureService.getComplexTypes();
			expect(Array.isArray(complexTypes)).toBe(true);
			expect(complexTypes.length).toBe(6);
		});

		it('should include all expected complex types', () => {
			const complexTypes = TypeStructureService.getComplexTypes();
			const expected = [
				'collection',
				'fixedCollection',
				'resourceLocator',
				'resourceMapper',
				'filter',
				'assignmentCollection',
			];

			for (const type of expected) {
				expect(complexTypes).toContain(type);
			}
		});

		it('should not include primitive types', () => {
			const complexTypes = TypeStructureService.getComplexTypes();
			expect(complexTypes).not.toContain('string');
			expect(complexTypes).not.toContain('number');
			expect(complexTypes).not.toContain('boolean');
		});
	});

	describe('getPrimitiveTypes', () => {
		it('should return array of primitive types', () => {
			const primitiveTypes = TypeStructureService.getPrimitiveTypes();
			expect(Array.isArray(primitiveTypes)).toBe(true);
			expect(primitiveTypes.length).toBe(6);
		});

		it('should include all expected primitive types', () => {
			const primitiveTypes = TypeStructureService.getPrimitiveTypes();
			const expected = ['string', 'number', 'boolean', 'dateTime', 'color', 'json'];

			for (const type of expected) {
				expect(primitiveTypes).toContain(type);
			}
		});

		it('should not include complex types', () => {
			const primitiveTypes = TypeStructureService.getPrimitiveTypes();
			expect(primitiveTypes).not.toContain('collection');
			expect(primitiveTypes).not.toContain('filter');
		});
	});

	describe('getComplexExamples', () => {
		it('should return examples for complex types', () => {
			const examples = TypeStructureService.getComplexExamples('collection');
			expect(examples).not.toBeNull();
			expect(typeof examples).toBe('object');
		});

		it('should return null for types without complex examples', () => {
			const examples = TypeStructureService.getComplexExamples(
				'resourceLocator' as any
			);
			expect(examples).toBeNull();
		});

		it('should return multiple scenarios for fixedCollection', () => {
			const examples = TypeStructureService.getComplexExamples('fixedCollection');
			expect(examples).not.toBeNull();
			expect(Object.keys(examples!).length).toBeGreaterThan(0);
		});

		it('should return valid filter examples', () => {
			const examples = TypeStructureService.getComplexExamples('filter');
			expect(examples).not.toBeNull();
			expect(examples!.simple).toBeDefined();
			expect(examples!.complex).toBeDefined();
		});
	});

	describe('validateTypeCompatibility', () => {
		describe('String Type', () => {
			it('should validate string values', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'Hello World',
					'string'
				);
				expect(result.valid).toBe(true);
				expect(result.errors).toHaveLength(0);
			});

			it('should reject non-string values', () => {
				const result = TypeStructureService.validateTypeCompatibility(123, 'string');
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			});

			it('should allow expressions in strings', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'{{ $json.name }}',
					'string'
				);
				expect(result.valid).toBe(true);
			});
		});

		describe('Number Type', () => {
			it('should validate number values', () => {
				const result = TypeStructureService.validateTypeCompatibility(42, 'number');
				expect(result.valid).toBe(true);
				expect(result.errors).toHaveLength(0);
			});

			it('should reject non-number values', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'not a number',
					'number'
				);
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			});
		});

		describe('Boolean Type', () => {
			it('should validate boolean values', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					true,
					'boolean'
				);
				expect(result.valid).toBe(true);
				expect(result.errors).toHaveLength(0);
			});

			it('should reject non-boolean values', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'true',
					'boolean'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('DateTime Type', () => {
			it('should validate ISO 8601 format', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'2024-01-20T10:30:00Z',
					'dateTime'
				);
				expect(result.valid).toBe(true);
			});

			it('should validate date-only format', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'2024-01-20',
					'dateTime'
				);
				expect(result.valid).toBe(true);
			});

			it('should reject invalid date formats', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'not a date',
					'dateTime'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('Color Type', () => {
			it('should validate hex colors', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'#FF5733',
					'color'
				);
				expect(result.valid).toBe(true);
			});

			it('should reject invalid color formats', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'red',
					'color'
				);
				expect(result.valid).toBe(false);
			});

			it('should reject short hex colors', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'#FFF',
					'color'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('JSON Type', () => {
			it('should validate valid JSON strings', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'{"key": "value"}',
					'json'
				);
				expect(result.valid).toBe(true);
			});

			it('should reject invalid JSON', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'{invalid json}',
					'json'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('Array Types', () => {
			it('should validate arrays for multiOptions', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					['option1', 'option2'],
					'multiOptions'
				);
				expect(result.valid).toBe(true);
			});

			it('should reject non-arrays for multiOptions', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'option1',
					'multiOptions'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('Object Types', () => {
			it('should validate objects for collection', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					{ name: 'John', age: 30 },
					'collection'
				);
				expect(result.valid).toBe(true);
			});

			it('should reject arrays for collection', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					['not', 'an', 'object'],
					'collection'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('Null and Undefined', () => {
			it('should handle null values based on allowEmpty', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					null,
					'string'
				);
				// String allows empty
				expect(result.valid).toBe(true);
			});

			it('should reject null for required types', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					null,
					'number'
				);
				expect(result.valid).toBe(false);
			});
		});

		describe('Unknown Types', () => {
			it('should handle unknown types gracefully', () => {
				const result = TypeStructureService.validateTypeCompatibility(
					'value',
					'unknownType' as NodePropertyTypes
				);
				expect(result.valid).toBe(false);
				expect(result.errors[0]).toContain('Unknown property type');
			});
		});
	});

	describe('getDescription', () => {
		it('should return description for valid types', () => {
			const description = TypeStructureService.getDescription('string');
			expect(description).not.toBeNull();
			expect(typeof description).toBe('string');
			expect(description!.length).toBeGreaterThan(0);
		});

		it('should return null for unknown types', () => {
			const description = TypeStructureService.getDescription(
				'unknown' as NodePropertyTypes
			);
			expect(description).toBeNull();
		});
	});

	describe('getNotes', () => {
		it('should return notes for types that have them', () => {
			const notes = TypeStructureService.getNotes('filter');
			expect(Array.isArray(notes)).toBe(true);
			expect(notes.length).toBeGreaterThan(0);
		});

		it('should return empty array for types without notes', () => {
			const notes = TypeStructureService.getNotes('number');
			expect(Array.isArray(notes)).toBe(true);
		});
	});

	describe('getJavaScriptType', () => {
		it('should return correct JavaScript type for primitives', () => {
			expect(TypeStructureService.getJavaScriptType('string')).toBe('string');
			expect(TypeStructureService.getJavaScriptType('number')).toBe('number');
			expect(TypeStructureService.getJavaScriptType('boolean')).toBe('boolean');
		});

		it('should return object for collection types', () => {
			expect(TypeStructureService.getJavaScriptType('collection')).toBe('object');
			expect(TypeStructureService.getJavaScriptType('filter')).toBe('object');
		});

		it('should return array for multiOptions', () => {
			expect(TypeStructureService.getJavaScriptType('multiOptions')).toBe('array');
		});

		it('should return null for unknown types', () => {
			expect(
				TypeStructureService.getJavaScriptType('unknown' as NodePropertyTypes)
			).toBeNull();
		});
	});
});
