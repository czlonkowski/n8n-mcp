/**
 * Type Structure Service
 *
 * Provides methods to query and work with n8n property type structures.
 * This service is stateless and uses static methods following the project's
 * PropertyFilter and ConfigValidator patterns.
 *
 * @module services/type-structure-service
 * @since 2.23.0
 */

import type { NodePropertyTypes } from 'n8n-workflow';
import type { TypeStructure } from '../types/type-structures';
import {
	isComplexType as isComplexTypeGuard,
	isPrimitiveType as isPrimitiveTypeGuard,
} from '../types/type-structures';
import { TYPE_STRUCTURES, COMPLEX_TYPE_EXAMPLES } from '../constants/type-structures';

/**
 * Result of type validation
 */
export interface TypeValidationResult {
	/**
	 * Whether the value is valid for the type
	 */
	valid: boolean;

	/**
	 * Validation errors if invalid
	 */
	errors: string[];

	/**
	 * Warnings that don't prevent validity
	 */
	warnings: string[];
}

/**
 * Service for querying and working with node property type structures
 *
 * Provides static methods to:
 * - Get type structure definitions
 * - Get example values
 * - Validate type compatibility
 * - Query type categories
 *
 * @example
 * ```typescript
 * // Get structure for a type
 * const structure = TypeStructureService.getStructure('collection');
 * console.log(structure.description); // "A group of related properties..."
 *
 * // Get example value
 * const example = TypeStructureService.getExample('filter');
 * console.log(example.combinator); // "and"
 *
 * // Check if type is complex
 * if (TypeStructureService.isComplexType('resourceMapper')) {
 *   console.log('This type needs special handling');
 * }
 * ```
 */
export class TypeStructureService {
	/**
	 * Get the structure definition for a property type
	 *
	 * Returns the complete structure definition including:
	 * - Type category (primitive/object/collection/special)
	 * - JavaScript type
	 * - Expected structure for complex types
	 * - Example values
	 * - Validation rules
	 *
	 * @param type - The NodePropertyType to query
	 * @returns Type structure definition, or null if type is unknown
	 *
	 * @example
	 * ```typescript
	 * const structure = TypeStructureService.getStructure('string');
	 * console.log(structure.jsType); // "string"
	 * console.log(structure.example); // "Hello World"
	 * ```
	 */
	static getStructure(type: NodePropertyTypes): TypeStructure | null {
		return TYPE_STRUCTURES[type] || null;
	}

	/**
	 * Get all type structure definitions
	 *
	 * Returns a record of all 24 NodePropertyTypes with their structures.
	 * Useful for documentation, validation setup, or UI generation.
	 *
	 * @returns Record mapping all types to their structures
	 *
	 * @example
	 * ```typescript
	 * const allStructures = TypeStructureService.getAllStructures();
	 * console.log(Object.keys(allStructures).length); // 22
	 * ```
	 */
	static getAllStructures(): Record<NodePropertyTypes, TypeStructure> {
		return { ...TYPE_STRUCTURES };
	}

	/**
	 * Get example value for a property type
	 *
	 * Returns a working example value that conforms to the type's
	 * expected structure. Useful for testing, documentation, or
	 * generating default values.
	 *
	 * @param type - The NodePropertyType to get an example for
	 * @returns Example value, or null if type is unknown
	 *
	 * @example
	 * ```typescript
	 * const example = TypeStructureService.getExample('number');
	 * console.log(example); // 42
	 *
	 * const filterExample = TypeStructureService.getExample('filter');
	 * console.log(filterExample.combinator); // "and"
	 * ```
	 */
	static getExample(type: NodePropertyTypes): any {
		const structure = this.getStructure(type);
		return structure ? structure.example : null;
	}

	/**
	 * Get all example values for a property type
	 *
	 * Some types have multiple examples to show different use cases.
	 * This returns all available examples, or falls back to the
	 * primary example if only one exists.
	 *
	 * @param type - The NodePropertyType to get examples for
	 * @returns Array of example values
	 *
	 * @example
	 * ```typescript
	 * const examples = TypeStructureService.getExamples('string');
	 * console.log(examples.length); // 4
	 * console.log(examples[0]); // ""
	 * console.log(examples[1]); // "A simple text"
	 * ```
	 */
	static getExamples(type: NodePropertyTypes): any[] {
		const structure = this.getStructure(type);
		if (!structure) return [];

		return structure.examples || [structure.example];
	}

	/**
	 * Check if a property type is complex
	 *
	 * Complex types have nested structures and require special
	 * validation logic beyond simple type checking.
	 *
	 * Complex types: collection, fixedCollection, resourceLocator,
	 * resourceMapper, filter, assignmentCollection
	 *
	 * @param type - The property type to check
	 * @returns True if the type is complex
	 *
	 * @example
	 * ```typescript
	 * TypeStructureService.isComplexType('collection'); // true
	 * TypeStructureService.isComplexType('string'); // false
	 * ```
	 */
	static isComplexType(type: NodePropertyTypes): boolean {
		return isComplexTypeGuard(type);
	}

	/**
	 * Check if a property type is primitive
	 *
	 * Primitive types map to simple JavaScript values and only
	 * need basic type validation.
	 *
	 * Primitive types: string, number, boolean, dateTime, color, json
	 *
	 * @param type - The property type to check
	 * @returns True if the type is primitive
	 *
	 * @example
	 * ```typescript
	 * TypeStructureService.isPrimitiveType('string'); // true
	 * TypeStructureService.isPrimitiveType('collection'); // false
	 * ```
	 */
	static isPrimitiveType(type: NodePropertyTypes): boolean {
		return isPrimitiveTypeGuard(type);
	}

	/**
	 * Get all complex property types
	 *
	 * Returns an array of all property types that are classified
	 * as complex (having nested structures).
	 *
	 * @returns Array of complex type names
	 *
	 * @example
	 * ```typescript
	 * const complexTypes = TypeStructureService.getComplexTypes();
	 * console.log(complexTypes);
	 * // ['collection', 'fixedCollection', 'resourceLocator', ...]
	 * ```
	 */
	static getComplexTypes(): NodePropertyTypes[] {
		return Object.entries(TYPE_STRUCTURES)
			.filter(([, structure]) => structure.type === 'collection' || structure.type === 'special')
			.filter(([type]) => this.isComplexType(type as NodePropertyTypes))
			.map(([type]) => type as NodePropertyTypes);
	}

	/**
	 * Get all primitive property types
	 *
	 * Returns an array of all property types that are classified
	 * as primitive (simple JavaScript values).
	 *
	 * @returns Array of primitive type names
	 *
	 * @example
	 * ```typescript
	 * const primitiveTypes = TypeStructureService.getPrimitiveTypes();
	 * console.log(primitiveTypes);
	 * // ['string', 'number', 'boolean', 'dateTime', 'color', 'json']
	 * ```
	 */
	static getPrimitiveTypes(): NodePropertyTypes[] {
		return Object.keys(TYPE_STRUCTURES).filter((type) =>
			this.isPrimitiveType(type as NodePropertyTypes)
		) as NodePropertyTypes[];
	}

	/**
	 * Get real-world examples for complex types
	 *
	 * Returns curated examples from actual n8n workflows showing
	 * different usage patterns for complex types.
	 *
	 * @param type - The complex type to get examples for
	 * @returns Object with named example scenarios, or null
	 *
	 * @example
	 * ```typescript
	 * const examples = TypeStructureService.getComplexExamples('fixedCollection');
	 * console.log(examples.httpHeaders);
	 * // { headers: [{ name: 'Content-Type', value: 'application/json' }] }
	 * ```
	 */
	static getComplexExamples(
		type: 'collection' | 'fixedCollection' | 'filter' | 'resourceMapper' | 'assignmentCollection'
	): Record<string, any> | null {
		return COMPLEX_TYPE_EXAMPLES[type] || null;
	}

	/**
	 * Validate basic type compatibility of a value
	 *
	 * Performs simple type checking to verify a value matches the
	 * expected JavaScript type for a property type. Does not perform
	 * deep structure validation for complex types.
	 *
	 * @param value - The value to validate
	 * @param type - The expected property type
	 * @returns Validation result with errors if invalid
	 *
	 * @example
	 * ```typescript
	 * const result = TypeStructureService.validateTypeCompatibility(
	 *   'Hello',
	 *   'string'
	 * );
	 * console.log(result.valid); // true
	 *
	 * const result2 = TypeStructureService.validateTypeCompatibility(
	 *   123,
	 *   'string'
	 * );
	 * console.log(result2.valid); // false
	 * console.log(result2.errors[0]); // "Expected string but got number"
	 * ```
	 */
	static validateTypeCompatibility(
		value: any,
		type: NodePropertyTypes
	): TypeValidationResult {
		const structure = this.getStructure(type);

		if (!structure) {
			return {
				valid: false,
				errors: [`Unknown property type: ${type}`],
				warnings: [],
			};
		}

		const errors: string[] = [];
		const warnings: string[] = [];

		// Handle null/undefined
		if (value === null || value === undefined) {
			if (!structure.validation?.allowEmpty) {
				errors.push(`Value is required for type ${type}`);
			}
			return { valid: errors.length === 0, errors, warnings };
		}

		// Check JavaScript type compatibility
		const actualType = Array.isArray(value) ? 'array' : typeof value;
		const expectedType = structure.jsType;

		if (expectedType !== 'any' && actualType !== expectedType) {
			// Special case: expressions are strings but might be allowed
			const isExpression = typeof value === 'string' && value.includes('{{');
			if (isExpression && structure.validation?.allowExpressions) {
				warnings.push(
					`Value contains n8n expression - cannot validate type until runtime`
				);
			} else {
				errors.push(`Expected ${expectedType} but got ${actualType}`);
			}
		}

		// Additional validation for specific types
		if (type === 'dateTime' && typeof value === 'string') {
			const pattern = structure.validation?.pattern;
			if (pattern && !new RegExp(pattern).test(value)) {
				errors.push(`Invalid dateTime format. Expected ISO 8601 format.`);
			}
		}

		if (type === 'color' && typeof value === 'string') {
			const pattern = structure.validation?.pattern;
			if (pattern && !new RegExp(pattern).test(value)) {
				errors.push(`Invalid color format. Expected 6-digit hex color (e.g., #FF5733).`);
			}
		}

		if (type === 'json' && typeof value === 'string') {
			try {
				JSON.parse(value);
			} catch {
				errors.push(`Invalid JSON string. Must be valid JSON when parsed.`);
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	/**
	 * Get type description
	 *
	 * Returns the human-readable description of what a property type
	 * represents and how it should be used.
	 *
	 * @param type - The property type
	 * @returns Description string, or null if type unknown
	 *
	 * @example
	 * ```typescript
	 * const description = TypeStructureService.getDescription('filter');
	 * console.log(description);
	 * // "Defines conditions for filtering data with boolean logic"
	 * ```
	 */
	static getDescription(type: NodePropertyTypes): string | null {
		const structure = this.getStructure(type);
		return structure ? structure.description : null;
	}

	/**
	 * Get type notes
	 *
	 * Returns additional notes, warnings, or usage tips for a type.
	 * Not all types have notes.
	 *
	 * @param type - The property type
	 * @returns Array of note strings, or empty array
	 *
	 * @example
	 * ```typescript
	 * const notes = TypeStructureService.getNotes('filter');
	 * console.log(notes[0]);
	 * // "Advanced filtering UI in n8n"
	 * ```
	 */
	static getNotes(type: NodePropertyTypes): string[] {
		const structure = this.getStructure(type);
		return structure?.notes || [];
	}

	/**
	 * Get JavaScript type for a property type
	 *
	 * Returns the underlying JavaScript type that the property
	 * type maps to (string, number, boolean, object, array, any).
	 *
	 * @param type - The property type
	 * @returns JavaScript type name, or null if unknown
	 *
	 * @example
	 * ```typescript
	 * TypeStructureService.getJavaScriptType('string'); // "string"
	 * TypeStructureService.getJavaScriptType('collection'); // "object"
	 * TypeStructureService.getJavaScriptType('multiOptions'); // "array"
	 * ```
	 */
	static getJavaScriptType(
		type: NodePropertyTypes
	): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any' | null {
		const structure = this.getStructure(type);
		return structure ? structure.jsType : null;
	}
}
