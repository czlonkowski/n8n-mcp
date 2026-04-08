/**
 * Tests for Type Structure constants
 *
 * @group unit
 * @group constants
 */

import { describe, it, expect } from 'vitest';
import { TYPE_STRUCTURES, COMPLEX_TYPE_EXAMPLES } from '@/constants/type-structures';
import { isTypeStructure } from '@/types/type-structures';
import type { NodePropertyTypes } from 'n8n-workflow';

describe('TYPE_STRUCTURES', () => {
	// All 22 NodePropertyTypes from n8n-workflow
	const ALL_PROPERTY_TYPES: NodePropertyTypes[] = [
		'boolean',
		'button',
		'collection',
		'color',
		'dateTime',
		'fixedCollection',
		'hidden',
		'json',
		'callout',
		'notice',
		'multiOptions',
		'number',
		'options',
		'string',
		'credentialsSelect',
		'resourceLocator',
		'curlImport',
		'resourceMapper',
		'filter',
		'assignmentCollection',
		'credentials',
		'workflowSelector',
	];

	describe('Completeness', () => {
		it('should define all 22 NodePropertyTypes', () => {
			const definedTypes = Object.keys(TYPE_STRUCTURES);
			expect(definedTypes).toHaveLength(22);

			for (const type of ALL_PROPERTY_TYPES) {
				expect(TYPE_STRUCTURES).toHaveProperty(type);
			}
		});

		it('should not have extra types beyond the 22 standard types', () => {
			const definedTypes = Object.keys(TYPE_STRUCTURES);
			const extraTypes = definedTypes.filter((type) => !ALL_PROPERTY_TYPES.includes(type as NodePropertyTypes));

			expect(extraTypes).toHaveLength(0);
		});
	});

	describe('Structure Validity', () => {
		it('should have valid TypeStructure for each type', () => {
			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				expect(isTypeStructure(structure)).toBe(true);
			}
		});

		it('should have required fields for all types', () => {
			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				expect(structure.type).toBeDefined();
				expect(structure.jsType).toBeDefined();
				expect(structure.description).toBeDefined();
				expect(structure.example).toBeDefined();

				expect(typeof structure.type).toBe('string');
				expect(typeof structure.jsType).toBe('string');
				expect(typeof structure.description).toBe('string');
			}
		});

		it('should have valid type categories', () => {
			const validCategories = ['primitive', 'object', 'array', 'collection', 'special'];

			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				expect(validCategories).toContain(structure.type);
			}
		});

		it('should have valid jsType values', () => {
			const validJsTypes = ['string', 'number', 'boolean', 'object', 'array', 'any'];

			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				expect(validJsTypes).toContain(structure.jsType);
			}
		});
	});

	describe('Example Validity', () => {
		it('should have non-null examples for all types', () => {
			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				expect(structure.example).toBeDefined();
			}
		});

		it('should have examples array when provided', () => {
			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				if (structure.examples) {
					expect(Array.isArray(structure.examples)).toBe(true);
					expect(structure.examples.length).toBeGreaterThan(0);
				}
			}
		});

		it('should have examples matching jsType for primitive types', () => {
			const primitiveTypes = ['string', 'number', 'boolean'];

			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				if (primitiveTypes.includes(structure.jsType)) {
					const exampleType = Array.isArray(structure.example)
						? 'array'
						: typeof structure.example;

					if (structure.jsType !== 'any' && exampleType !== 'string') {
						// Allow strings for expressions
						expect(exampleType).toBe(structure.jsType);
					}
				}
			}
		});

		it('should have object examples for collection types', () => {
			const collectionTypes: NodePropertyTypes[] = ['collection', 'fixedCollection'];

			for (const type of collectionTypes) {
				const structure = TYPE_STRUCTURES[type];
				expect(typeof structure.example).toBe('object');
				expect(structure.example).not.toBeNull();
			}
		});

		it('should have array examples for multiOptions', () => {
			const structure = TYPE_STRUCTURES.multiOptions;
			expect(Array.isArray(structure.example)).toBe(true);
		});
	});

	describe('Specific Type Definitions', () => {
		describe('Primitive Types', () => {
			it('should define string correctly', () => {
				const structure = TYPE_STRUCTURES.string;
				expect(structure.type).toBe('primitive');
				expect(structure.jsType).toBe('string');
				expect(typeof structure.example).toBe('string');
			});

			it('should define number correctly', () => {
				const structure = TYPE_STRUCTURES.number;
				expect(structure.type).toBe('primitive');
				expect(structure.jsType).toBe('number');
				expect(typeof structure.example).toBe('number');
			});

			it('should define boolean correctly', () => {
				const structure = TYPE_STRUCTURES.boolean;
				expect(structure.type).toBe('primitive');
				expect(structure.jsType).toBe('boolean');
				expect(typeof structure.example).toBe('boolean');
			});

			it('should define dateTime correctly', () => {
				const structure = TYPE_STRUCTURES.dateTime;
				expect(structure.type).toBe('primitive');
				expect(structure.jsType).toBe('string');
				expect(structure.validation?.pattern).toBeDefined();
			});

			it('should define color correctly', () => {
				const structure = TYPE_STRUCTURES.color;
				expect(structure.type).toBe('primitive');
				expect(structure.jsType).toBe('string');
				expect(structure.validation?.pattern).toBeDefined();
				expect(structure.example).toMatch(/^#[0-9A-Fa-f]{6}$/);
			});

			it('should define json correctly', () => {
				const structure = TYPE_STRUCTURES.json;
				expect(structure.type).toBe('primitive');
				expect(structure.jsType).toBe('string');
				expect(() => JSON.parse(structure.example)).not.toThrow();
			});
		});

		describe('Complex Types', () => {
			it('should define collection with structure', () => {
				const structure = TYPE_STRUCTURES.collection;
				expect(structure.type).toBe('collection');
				expect(structure.jsType).toBe('object');
				expect(structure.structure).toBeDefined();
			});

			it('should define fixedCollection with structure', () => {
				const structure = TYPE_STRUCTURES.fixedCollection;
				expect(structure.type).toBe('collection');
				expect(structure.jsType).toBe('object');
				expect(structure.structure).toBeDefined();
			});

			it('should define resourceLocator with mode and value', () => {
				const structure = TYPE_STRUCTURES.resourceLocator;
				expect(structure.type).toBe('special');
				expect(structure.structure?.properties?.mode).toBeDefined();
				expect(structure.structure?.properties?.value).toBeDefined();
				expect(structure.example).toHaveProperty('mode');
				expect(structure.example).toHaveProperty('value');
			});

			it('should define resourceMapper with mappingMode', () => {
				const structure = TYPE_STRUCTURES.resourceMapper;
				expect(structure.type).toBe('special');
				expect(structure.structure?.properties?.mappingMode).toBeDefined();
				expect(structure.example).toHaveProperty('mappingMode');
			});

			it('should define filter with conditions and combinator', () => {
				const structure = TYPE_STRUCTURES.filter;
				expect(structure.type).toBe('special');
				expect(structure.structure?.properties?.conditions).toBeDefined();
				expect(structure.structure?.properties?.combinator).toBeDefined();
				expect(structure.example).toHaveProperty('conditions');
				expect(structure.example).toHaveProperty('combinator');
			});

			it('should define assignmentCollection with assignments', () => {
				const structure = TYPE_STRUCTURES.assignmentCollection;
				expect(structure.type).toBe('special');
				expect(structure.structure?.properties?.assignments).toBeDefined();
				expect(structure.example).toHaveProperty('assignments');
			});
		});

		describe('UI Types', () => {
			it('should define hidden as special type', () => {
				const structure = TYPE_STRUCTURES.hidden;
				expect(structure.type).toBe('special');
			});

			it('should define button as special type', () => {
				const structure = TYPE_STRUCTURES.button;
				expect(structure.type).toBe('special');
			});

			it('should define callout as special type', () => {
				const structure = TYPE_STRUCTURES.callout;
				expect(structure.type).toBe('special');
			});

			it('should define notice as special type', () => {
				const structure = TYPE_STRUCTURES.notice;
				expect(structure.type).toBe('special');
			});
		});
	});

	describe('Validation Rules', () => {
		it('should have validation rules for types that need them', () => {
			const typesWithValidation = [
				'string',
				'number',
				'boolean',
				'dateTime',
				'color',
				'json',
			];

			for (const type of typesWithValidation) {
				const structure = TYPE_STRUCTURES[type as NodePropertyTypes];
				expect(structure.validation).toBeDefined();
			}
		});

		it('should specify allowExpressions correctly', () => {
			// Types that allow expressions
			const allowExpressionsTypes = ['string', 'dateTime', 'color', 'json'];

			for (const type of allowExpressionsTypes) {
				const structure = TYPE_STRUCTURES[type as NodePropertyTypes];
				expect(structure.validation?.allowExpressions).toBe(true);
			}

			// Types that don't allow expressions
			expect(TYPE_STRUCTURES.boolean.validation?.allowExpressions).toBe(false);
		});

		it('should have patterns for format-sensitive types', () => {
			expect(TYPE_STRUCTURES.dateTime.validation?.pattern).toBeDefined();
			expect(TYPE_STRUCTURES.color.validation?.pattern).toBeDefined();
		});
	});

	describe('Documentation Quality', () => {
		it('should have descriptions for all types', () => {
			for (const [typeName, structure] of Object.entries(TYPE_STRUCTURES)) {
				expect(structure.description).toBeDefined();
				expect(structure.description.length).toBeGreaterThan(10);
			}
		});

		it('should have notes for complex types', () => {
			const complexTypes = ['collection', 'fixedCollection', 'filter', 'resourceMapper'];

			for (const type of complexTypes) {
				const structure = TYPE_STRUCTURES[type as NodePropertyTypes];
				expect(structure.notes).toBeDefined();
				expect(structure.notes!.length).toBeGreaterThan(0);
			}
		});
	});
});

describe('COMPLEX_TYPE_EXAMPLES', () => {
	it('should have examples for all complex types', () => {
		const complexTypes = ['collection', 'fixedCollection', 'filter', 'resourceMapper', 'assignmentCollection'];

		for (const type of complexTypes) {
			expect(COMPLEX_TYPE_EXAMPLES).toHaveProperty(type);
			expect(COMPLEX_TYPE_EXAMPLES[type as keyof typeof COMPLEX_TYPE_EXAMPLES]).toBeDefined();
		}
	});

	it('should have multiple example scenarios for each type', () => {
		for (const [type, examples] of Object.entries(COMPLEX_TYPE_EXAMPLES)) {
			expect(Object.keys(examples).length).toBeGreaterThan(0);
		}
	});

	it('should have valid collection examples', () => {
		const examples = COMPLEX_TYPE_EXAMPLES.collection;
		expect(examples.basic).toBeDefined();
		expect(typeof examples.basic).toBe('object');
	});

	it('should have valid fixedCollection examples', () => {
		const examples = COMPLEX_TYPE_EXAMPLES.fixedCollection;
		expect(examples.httpHeaders).toBeDefined();
		expect(examples.httpHeaders.headers).toBeDefined();
		expect(Array.isArray(examples.httpHeaders.headers)).toBe(true);
	});

	it('should have valid filter examples', () => {
		const examples = COMPLEX_TYPE_EXAMPLES.filter;
		expect(examples.simple).toBeDefined();
		expect(examples.simple.conditions).toBeDefined();
		expect(examples.simple.combinator).toBeDefined();
	});

	it('should have valid resourceMapper examples', () => {
		const examples = COMPLEX_TYPE_EXAMPLES.resourceMapper;
		expect(examples.autoMap).toBeDefined();
		expect(examples.manual).toBeDefined();
		expect(examples.manual.mappingMode).toBe('defineBelow');
	});

	it('should have valid assignmentCollection examples', () => {
		const examples = COMPLEX_TYPE_EXAMPLES.assignmentCollection;
		expect(examples.basic).toBeDefined();
		expect(examples.basic.assignments).toBeDefined();
		expect(Array.isArray(examples.basic.assignments)).toBe(true);
	});
});
