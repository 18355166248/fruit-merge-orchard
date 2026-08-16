import { useEffect, useState } from "react";
import { applyImageFallback, fruitAsset, gameAsset, localFruitAsset } from "./gameAssets";

type CollectionItem = {
  id: string;
  name: string;
  level: number;
  image: () => string;
};

type CollectionCategory = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  items: CollectionItem[];
};

const FRUIT_NAMES = ["蓝莓", "草莓", "葡萄", "甜橙", "红苹果", "雪梨", "菠萝", "哈密瓜", "西柚", "西瓜", "金果王"];

// 图鉴分类与页面渲染解耦；后续增加新的堆叠主题时，只需向这里追加分类和对应素材。
export const COLLECTION_CATEGORIES: CollectionCategory[] = [
  {
    id: "fruit",
    label: "水果",
    eyebrow: "FRUIT COLLECTION",
    title: "果园合成链",
    description: "每两个相同水果相遇，就会成长为下一级果实。",
    items: FRUIT_NAMES.map((name, level) => ({
      id: `fruit-${level + 1}`,
      name,
      level,
      image: () => fruitAsset(level),
    })),
  },
];

type CollectionScreenProps = {
  onClose: () => void;
};

export function CollectionScreen({ onClose }: CollectionScreenProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState(COLLECTION_CATEGORIES[0].id);
  const selectedCategory = COLLECTION_CATEGORIES.find((category) => category.id === selectedCategoryId) ?? COLLECTION_CATEGORIES[0];

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <section className="collection-screen" role="dialog" aria-modal="true" aria-label="游戏图鉴">
      <img className="collection-background" src={gameAsset("background")} alt="" />
      <div className="collection-screen-content">
        <header className="collection-header">
          <button onClick={onClose} aria-label="关闭游戏图鉴" autoFocus>返回游戏</button>
          <div><small>MERGE COLLECTION</small><strong>堆叠图鉴</strong></div>
          <span aria-hidden="true">册</span>
        </header>

        <div className="collection-tabs" role="tablist" aria-label="图鉴分类">
          {COLLECTION_CATEGORIES.map((category) => (
            <button
              key={category.id}
              id={`collection-tab-${category.id}`}
              role="tab"
              aria-selected={category.id === selectedCategory.id}
              aria-controls={`collection-panel-${category.id}`}
              onClick={() => setSelectedCategoryId(category.id)}
            >
              {category.label}
            </button>
          ))}
          <span>更多主题陆续加入</span>
        </div>

        <section
          className="collection-panel"
          id={`collection-panel-${selectedCategory.id}`}
          role="tabpanel"
          aria-labelledby={`collection-tab-${selectedCategory.id}`}
        >
          <header className="collection-intro">
            <small>{selectedCategory.eyebrow}</small>
            <strong>{selectedCategory.title}</strong>
            <p>{selectedCategory.description}</p>
            <span>{selectedCategory.items.length} 种</span>
          </header>

          <div className="collection-grid">
            {selectedCategory.items.map((item) => (
              <article className="collection-item" key={item.id}>
                <span className="collection-level">LEVEL {String(item.level + 1).padStart(2, "0")}</span>
                <img src={item.image()} onError={(event) => applyImageFallback(event.currentTarget, localFruitAsset(item.level))} alt={item.name} />
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.level === 0 ? "合成起点" : `由两个 ${FRUIT_NAMES[item.level - 1]} 合成`}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
