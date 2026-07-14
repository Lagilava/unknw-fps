class GLTFMaterialsPbrSpecularGlossinessExtension {
  constructor(parser, THREE) {
    this.parser = parser;
    this.THREE = THREE;
    this.name = "KHR_materials_pbrSpecularGlossiness";
  }

  getMaterialType(materialIndex) {
    const materialDef = this.parser.json.materials?.[materialIndex];
    if (!materialDef?.extensions?.[this.name]) return null;
    return this.THREE.MeshPhysicalMaterial;
  }

  extendMaterialParams(materialIndex, materialParams) {
    const THREE = this.THREE;
    const materialDef = this.parser.json.materials?.[materialIndex];
    const extension = materialDef?.extensions?.[this.name];

    if (!extension) return Promise.resolve();

    materialParams.metalness = 0;
    materialParams.roughness = 1;

    if (Array.isArray(extension.diffuseFactor)) {
      materialParams.color = new THREE.Color().fromArray(extension.diffuseFactor);
      materialParams.opacity = extension.diffuseFactor[3] !== undefined ? extension.diffuseFactor[3] : 1;
    }

    if (Array.isArray(extension.specularFactor)) {
      materialParams.specularColor = new THREE.Color().fromArray(extension.specularFactor);
    }

    if (extension.glossinessFactor !== undefined) {
      materialParams.roughness = 1 - extension.glossinessFactor;
    }

    const pending = [];

    if (extension.diffuseTexture) {
      pending.push(this.parser.assignTexture(materialParams, "map", extension.diffuseTexture, THREE.SRGBColorSpace));
    }

    return Promise.all(pending);
  }
}

export function createGLTFLoader(THREE, GLTFLoader) {
  const loader = new GLTFLoader();
  loader.register(parser => new GLTFMaterialsPbrSpecularGlossinessExtension(parser, THREE));
  return loader;
}
